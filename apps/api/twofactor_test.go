package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"testing"
	"time"
)

func otpForTest(secret string, step int64) string {
	key, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(step))
	m := hmac.New(sha1.New, key)
	m.Write(buf[:])
	sum := m.Sum(nil)
	offset := sum[19] & 15
	return fmt.Sprintf("%06d", (binary.BigEndian.Uint32(sum[offset:offset+4])&0x7fffffff)%1000000)
}
func TestTOTPRFC6238AndEncryption(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if otpStep(secret, "287082", time.Unix(59, 0)) != 1 {
		t.Fatal("RFC SHA1 vector failed")
	}
	if otpStep(secret, "287083", time.Unix(59, 0)) != 0 || otpStep(secret, "12345", time.Unix(59, 0)) != 0 {
		t.Fatal("invalid OTP accepted")
	}
	t.Setenv("CONFIG_DIR", t.TempDir())
	enc, e := encryptOTP(secret)
	if e != nil || strings.Contains(enc, secret) {
		t.Fatal("secret encryption failed")
	}
	got, e := decryptOTP(enc)
	if e != nil || got != secret {
		t.Fatal("decrypt failed")
	}
	if _, e = decryptOTP(enc[:len(enc)-4] + "AAAA"); e == nil {
		t.Fatal("tampering accepted")
	}
}
