package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestSharedRedisNamespacesWithACL(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL required")
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	admin := redis.NewClient(opt)
	defer admin.Close()
	ctx := context.Background()
	clients := make([]*redis.Client, 0, 2)
	for i := 0; i < 2; i++ {
		id := uid()
		prefix := "meet:" + id + ":"
		user := "ns_test_" + id
		pass := uid() + uid()
		if err := admin.Do(ctx, "ACL", "SETUSER", user, "reset", "on", ">"+pass, "~"+prefix+"*", "+@all", "-flushall", "-flushdb", "-scan", "-keys", "-select", "-acl", "-config").Err(); err != nil {
			t.Fatal(err)
		}
		defer admin.Do(ctx, "ACL", "DELUSER", user)
		settings := *opt
		settings.DB = 0
		settings.Username = user
		settings.Password = pass
		c := redis.NewClient(&settings)
		c.AddHook(redisNamespace{prefix})
		defer c.Close()
		clients = append(clients, c)
		if err := c.Set(ctx, "session:identical", "site"+string(rune('a'+i)), time.Minute).Err(); err != nil {
			t.Fatal(err)
		}

		// Cleanup through the site's client so other test data is never flushed.
		defer c.Del(ctx, "session:identical", "sfu-failover-pending", "sfu-failover-request:school:meeting")
	}
	for i, c := range clients {
		value, err := c.Get(ctx, "session:identical").Result()
		if err != nil || value != "site"+string(rune('a'+i)) {
			t.Fatalf("namespace leak: %q %v", value, err)
		}
		if err := c.Do(ctx, "FLUSHALL").Err(); err == nil {
			t.Fatal("FLUSHALL accepted")
		}
	}
	a := &app{cache: clients[0]}
	if err := a.queueSFUFailover(ctx, "school", "meeting", []byte(`{"verified":true}`)); err != nil {
		t.Fatal(err)
	}
	pending, err := clients[0].SPopN(ctx, "sfu-failover-pending", 5).Result()
	if err != nil || len(pending) != 1 {
		t.Fatalf("queue: %v %v", pending, err)
	}
	if strings.HasPrefix(pending[0], "meet:") {
		t.Fatal("queue values must retain logical keys")
	}
	if _, err := clients[0].GetDel(ctx, pending[0]).Result(); err != nil {
		t.Fatal(err)
	}
	if value, err := clients[1].Exists(ctx, "sfu-failover-pending").Result(); err != nil || value != 0 {
		t.Fatal("queue leaked", err)
	}
}
