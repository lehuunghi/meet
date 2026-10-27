package main

import "fmt"

type academyNewsLink struct {
	Number            int
	URL               string
	Current, Ellipsis bool
}
type academyNewsPage struct {
	Items              []academyPost
	Page, Pages, Total int
	Previous, Next     string
	Links              []academyNewsLink
}

func websiteNews(posts []academyPost, page int) academyNewsPage {
	visible := []academyPost{}
	for _, p := range posts {
		if p.Published {
			visible = append(visible, p)
		}
	}
	pages := (len(visible) + 3) / 4
	if pages < 1 {
		pages = 1
	}
	if page < 1 {
		page = 1
	}
	if page > pages {
		page = pages
	}
	n := academyNewsPage{Items: []academyPost{}, Page: page, Pages: pages, Total: len(visible)}
	start := (page - 1) * 4
	end := start + 4
	if end > len(visible) {
		end = len(visible)
	}
	if start < len(visible) {
		n.Items = visible[start:end]
	}
	link := func(i int) string { return fmt.Sprintf("/?tin=%d#tin-tuc", i) }
	if page > 1 {
		n.Previous = link(page - 1)
	}
	if page < pages {
		n.Next = link(page + 1)
	}
	last := 0
	for i := 1; i <= pages; i++ {
		if i == 1 || i == pages || (i >= page-1 && i <= page+1) {
			if last > 0 && i > last+1 {
				n.Links = append(n.Links, academyNewsLink{Ellipsis: true})
			}
			n.Links = append(n.Links, academyNewsLink{Number: i, URL: link(i), Current: i == page})
			last = i
		}
	}
	return n
}
