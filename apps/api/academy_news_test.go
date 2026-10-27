package main

import (
	"fmt"
	"testing"
)

func TestNewsPaginationOnlyPublishedFourAtATime(t *testing.T) {
	posts := []academyPost{}
	for i := 0; i < 11; i++ {
		posts = append(posts, academyPost{Slug: fmt.Sprint(i), Title: fmt.Sprint(i), Published: i != 3 && i != 8})
	}
	seen := map[string]bool{}
	for page := 1; page <= 3; page++ {
		n := websiteNews(posts, page)
		if n.Pages != 3 || n.Total != 9 || n.Page != page {
			t.Fatal("bad page metadata", n)
		}
		if page < 3 && len(n.Items) != 4 {
			t.Fatal("must show four articles")
		}
		for _, p := range n.Items {
			if !p.Published || seen[p.Slug] {
				t.Fatal("draft or duplicate article")
			}
			seen[p.Slug] = true
		}
	}
	if len(seen) != 9 {
		t.Fatal("lost article")
	}
	if n := websiteNews(nil, 1); len(n.Items) != 0 || n.Pages != 1 {
		t.Fatal("bad empty state")
	}
}
