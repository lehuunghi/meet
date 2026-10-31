package main

import (
	"context"
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"
)

func TestRedisNamespaceCommands(t *testing.T) {
	h := redisNamespace{"meet:" + strings.Repeat("a", 32) + ":"}
	for _, args := range [][]interface{}{{"get", "session:token"}, {"mset", "a", 1, "b", 2}, {"eval", "return redis.call('GET',KEYS[1])", 1, "lock"}, {"scan", 0, "match", "sfu:*", "count", 20}} {
		cmd := redis.NewCmd(context.Background(), args...)
		if err := h.rewrite(cmd); err != nil {
			t.Fatal(err)
		}
		if err := h.rewrite(cmd); err != nil {
			t.Fatal(err)
		} // retries must not double-prefix keys
		count := 0
		for _, a := range cmd.Args() {
			if s, ok := a.(string); ok && strings.HasPrefix(s, h.prefix) {
				count++
				if strings.Contains(strings.TrimPrefix(s, h.prefix), h.prefix) {
					t.Fatal("double prefix")
				}
			}
		}
		if count == 0 {
			t.Fatal("command was not isolated", args)
		}
	}
	for _, args := range [][]interface{}{{"flushall"}, {"keys", "*"}, {"scan", 0}, {"eval", "return 1", -1}} {
		if h.rewrite(redis.NewCmd(context.Background(), args...)) == nil {
			t.Fatal("unsafe command accepted", args)
		}
	}
}
func TestRedisNamespaceConfiguration(t *testing.T) {
	c := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer c.Close()
	t.Setenv("REDIS_KEY_PREFIX", "other:*")
	if configureRedisNamespace(c) == nil {
		t.Fatal("unsafe namespace accepted")
	}
	t.Setenv("REDIS_KEY_PREFIX", "meet:"+strings.Repeat("a", 32)+":")
	if err := configureRedisNamespace(c); err != nil {
		t.Fatal(err)
	}
}
