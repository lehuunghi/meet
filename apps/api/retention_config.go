package main

func configuredRetention() int {
	c, e := loadSettings()
	if e != nil || c.Retention < 1 || c.Retention > 3650 {
		return 30
	}
	return c.Retention
}
