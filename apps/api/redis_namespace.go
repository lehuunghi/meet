package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"
)

// A shared Redis account is also restricted by server-side ACLs. This hook
// applies the namespace to ordinary commands, transactions and Lua KEYS.
type redisNamespace struct{ prefix string }

func configureRedisNamespace(c *redis.Client) error {
	prefix := os.Getenv("REDIS_KEY_PREFIX")
	if prefix == "" {
		return nil
	}
	if !regexp.MustCompile(`^meet:[a-f0-9]{32}:$`).MatchString(prefix) {
		return fmt.Errorf("invalid Redis namespace")
	}
	c.AddHook(redisNamespace{prefix})
	return nil
}
func (h redisNamespace) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) { return next(ctx, network, addr) }
}
func (h redisNamespace) key(args []interface{}, i int) {
	s := fmt.Sprint(args[i])
	if !strings.HasPrefix(s, h.prefix) {
		args[i] = h.prefix + s
	}
}
func (h redisNamespace) rewrite(cmd redis.Cmder) error {
	args := cmd.Args()
	if len(args) == 0 {
		return fmt.Errorf("empty Redis command")
	}
	switch strings.ToLower(fmt.Sprint(args[0])) {
	case "get", "getdel", "set", "setnx", "setex", "psetex", "getset", "incr", "incrby", "decr", "expire", "pexpire", "ttl", "pttl", "lpush", "lrange", "ltrim", "sadd", "spop":
		if len(args) < 2 {
			return fmt.Errorf("missing Redis key")
		}
		h.key(args, 1)
	case "del", "unlink", "exists", "mget", "watch":
		for i := 1; i < len(args); i++ {
			h.key(args, i)
		}
	case "mset", "msetnx":
		for i := 1; i < len(args); i += 2 {
			h.key(args, i)
		}
	case "eval", "evalsha":
		if len(args) < 3 {
			return fmt.Errorf("invalid Redis script")
		}
		n, e := strconv.Atoi(fmt.Sprint(args[2]))
		if e != nil || n < 0 || 3+n > len(args) {
			return fmt.Errorf("invalid Redis script keys")
		}
		for i := 3; i < 3+n; i++ {
			h.key(args, i)
		}
	case "scan":
		found := false
		for i := 2; i+1 < len(args); i++ {
			if strings.EqualFold(fmt.Sprint(args[i]), "match") {
				h.key(args, i+1)
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("shared Redis SCAN requires a namespace pattern")
		}
	case "ping", "hello", "auth", "client", "select", "script", "multi", "exec", "discard", "unwatch":
		// The server ACL separately denies privileged subcommands and database changes.
	default:
		return fmt.Errorf("Redis command unavailable in shared mode: %s", cmd.Name())
	}
	return nil
}
func (h redisNamespace) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		if e := h.rewrite(cmd); e != nil {
			return e
		}
		e := next(ctx, cmd)
		if e == nil {
			if scan, ok := cmd.(*redis.ScanCmd); ok {
				keys, cursor := scan.Val()
				for i := range keys {
					keys[i] = strings.TrimPrefix(keys[i], h.prefix)
				}
				scan.SetVal(keys, cursor)
			}
		}
		return e
	}
}
func (h redisNamespace) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		for _, cmd := range cmds {
			if e := h.rewrite(cmd); e != nil {
				return e
			}
		}
		return next(ctx, cmds)
	}
}
