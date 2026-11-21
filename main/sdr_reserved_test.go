package main

import "testing"

func TestIsReservedSerial(t *testing.T) {
	cases := map[string]bool{
		"rb:nav1":     true,
		"rb:radio1":   true,
		"stx:1090:0":  false,
		"stratux:978": false,
		"00000001":    false,
		"":            false,
		"VOR01":       false,
		"xrb:nav1":    false,
	}
	for s, want := range cases {
		if got := isReservedSerial(s); got != want {
			t.Errorf("isReservedSerial(%q) = %v, want %v", s, got, want)
		}
	}
	// a reserved serial must not look like any band tag either
	if rES.hasID("rb:nav1") || rUAT.hasID("rb:nav1") {
		t.Error("rb:nav1 matched a band regex")
	}
}
