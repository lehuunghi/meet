package main

import (
	"encoding/json"
	"net/http"
	"time"
)

type roomReaction struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Emoji string `json:"emoji"`
}

func (a *app) roomReactions(w http.ResponseWriter, r *http.Request) {
	if !a.roomGate(w, r) {
		return
	}
	if !a.liveMember(r) {
		problem(w, 409, "Vào buổi học trước khi dùng phản ứng")
		return
	}
	u := who(r)
	key := "room-reactions:" + u.School + ":" + r.PathValue("id")
	if r.Method == "GET" {
		items, e := a.cache.LRange(r.Context(), key, 0, 29).Result()
		if e != nil {
			problem(w, 503, "Không đọc được phản ứng")
			return
		}
		out := []roomReaction{}
		for _, s := range items {
			var v roomReaction
			if json.Unmarshal([]byte(s), &v) == nil {
				out = append(out, v)
			}
		}
		send(w, 200, out)
		return
	}
	var in struct {
		Emoji string `json:"emoji"`
	}
	if !decode(w, r, &in) {
		return
	}
	valid := false
	for _, v := range []string{"👍", "👏", "❤️", "😂", "🎉"} {
		if in.Emoji == v {
			valid = true
		}
	}
	if !valid {
		problem(w, 400, "Phản ứng không hợp lệ")
		return
	}
	count, e := a.cache.Eval(r.Context(), `local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],10) end;return n`, []string{key + ":" + u.ID}).Int()
	if e != nil {
		problem(w, 503, "Phản ứng chưa sẵn sàng")
		return
	}
	if count > 5 {
		problem(w, 429, "Gửi tối đa 5 phản ứng mỗi 10 giây")
		return
	}
	raw, _ := json.Marshal(roomReaction{uid(), u.Name, in.Emoji})
	pipe := a.cache.TxPipeline()
	pipe.LPush(r.Context(), key, string(raw))
	pipe.LTrim(r.Context(), key, 0, 29)
	pipe.Expire(r.Context(), key, 30*time.Second)
	if _, e = pipe.Exec(r.Context()); e != nil {
		problem(w, 503, "Không gửi được phản ứng")
		return
	}
	send(w, 201, map[string]bool{"ok": true})
}
