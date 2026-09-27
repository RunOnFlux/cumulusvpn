package price

import (
	"encoding/json"
	"os"
	"testing"
)

func mustParse(t *testing.T, s string) Schedule {
	t.Helper()
	sch, err := Parse(s)
	if err != nil {
		t.Fatalf("Parse(%q): %v", s, err)
	}
	return sch
}

func TestParseAndString(t *testing.T) {
	cases := map[string]string{
		"20":                 "20@0",
		" 20 ":               "20@0",
		"20@0":               "20@0",
		"4.5":                "4.5@0",
		"20@0,12@2215000":    "20@0,12@2215000",
		"20 @ 0 , 12@100":    "20@0,12@100",
		"20,12@100,16.5@200": "20@0,12@100,16.5@200",
	}
	for in, want := range cases {
		if got := mustParse(t, in).String(); got != want {
			t.Errorf("Parse(%q).String() = %q, want %q", in, got, want)
		}
	}
}

func TestParseRejects(t *testing.T) {
	for _, in := range []string{
		"", " ", "0", "-1", "abc", "NaN", "Inf", "20@5", // first entry must start at 0
		"20,12",     // later entry without a height
		"20@0,12@0", // not strictly increasing
		"20@0,12@100,16@50",
		"20@0,12@-5",
		"20@0,12@1.5",
		"20@0,",
		"20@0,@100",
		"1e3", ".5", "5.", "+5", "0x10", "20@0,12@+100", "20@0,12@1e3",
	} {
		if _, err := Parse(in); err == nil {
			t.Errorf("Parse(%q) accepted, want error", in)
		}
	}
}

func TestAtAndEffective(t *testing.T) {
	// Drop 20 -> 12 at 1000, rise 12 -> 16 at 50000.
	s := mustParse(t, "20@0,12@1000,16@50000")
	cases := []struct {
		h         int64
		at, effec float64
	}{
		{0, 20, 20},
		{999, 20, 20},
		// A drop applies at once: min(20, 12) = 12 either way.
		{1000, 12, 12},
		{1000 + GraceBlocks, 12, 12},
		{49999, 12, 12},
		// A rise quotes the new price but honours the old one for the grace window.
		{50000, 16, 12},
		{50000 + GraceBlocks - 1, 16, 12},
		{50000 + GraceBlocks, 16, 16},
	}
	for _, tc := range cases {
		if got := s.At(tc.h); got != tc.at {
			t.Errorf("At(%d) = %v, want %v", tc.h, got, tc.at)
		}
		if got := s.Effective(tc.h); got != tc.effec {
			t.Errorf("Effective(%d) = %v, want %v", tc.h, got, tc.effec)
		}
	}
}

func TestEffectiveSpansSeveralChangesInsideGrace(t *testing.T) {
	// Two rises inside one grace window: the lowest of all three is honoured
	// until the window has passed the FIRST change.
	s := mustParse(t, "10@0,12@1000,14@2000")
	if got := s.Effective(2000); got != 10 {
		t.Errorf("Effective(2000) = %v, want 10", got)
	}
	if got := s.Effective(1000 + GraceBlocks); got != 12 {
		t.Errorf("Effective(1000+grace) = %v, want 12", got)
	}
	if got := s.Effective(2000 + GraceBlocks); got != 14 {
		t.Errorf("Effective(2000+grace) = %v, want 14", got)
	}
}

func TestFlatMatchesLegacyConstant(t *testing.T) {
	s := Flat(20)
	for _, h := range []int64{0, 1, 1 << 40} {
		if s.At(h) != 20 || s.Effective(h) != 20 {
			t.Fatalf("Flat(20) at %d = %v/%v", h, s.At(h), s.Effective(h))
		}
	}
	if !s.Equal(mustParse(t, "20")) {
		t.Fatal("Flat(20) != Parse(\"20\")")
	}
}

func TestExtends(t *testing.T) {
	base := mustParse(t, "20")
	next := mustParse(t, "20@0,12@1000")
	if !next.Extends(base, 999) {
		t.Error("appending an entry above the cursor must extend")
	}
	if next.Extends(base, 1000) {
		t.Error("an appended entry at/below the cursor re-judges folded txs")
	}
	if !base.Extends(base, 1<<40) {
		t.Error("a schedule extends itself")
	}
	if mustParse(t, "25@0,12@1000").Extends(base, 0) {
		t.Error("an edited history entry is not an extension")
	}
	if base.Extends(next, 0) {
		t.Error("dropping an entry is not an extension")
	}
}

// TestSharedVectors runs the cross-language contract in testdata/vectors.json,
// which the bridge and the deploy tooling run too.
func TestSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		GraceBlocks int64 `json:"grace_blocks"`
		Valid       []struct {
			In        string  `json:"in"`
			Canonical string  `json:"canonical"`
			Latest    float64 `json:"latest"`
			Points    []struct {
				H         int64   `json:"h"`
				At        float64 `json:"at"`
				Effective float64 `json:"effective"`
			} `json:"points"`
		} `json:"valid"`
		Invalid []string `json:"invalid"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if v.GraceBlocks != GraceBlocks {
		t.Fatalf("vectors grace_blocks = %d, GraceBlocks = %d", v.GraceBlocks, GraceBlocks)
	}
	for _, c := range v.Valid {
		s := mustParse(t, c.In)
		if s.String() != c.Canonical || s.Latest() != c.Latest {
			t.Errorf("%q: canonical=%q latest=%v, want %q/%v", c.In, s.String(), s.Latest(), c.Canonical, c.Latest)
		}
		for _, p := range c.Points {
			if s.At(p.H) != p.At || s.Effective(p.H) != p.Effective {
				t.Errorf("%q at %d: At=%v Effective=%v, want %v/%v", c.In, p.H, s.At(p.H), s.Effective(p.H), p.At, p.Effective)
			}
		}
	}
	for _, in := range v.Invalid {
		if _, err := Parse(in); err == nil {
			t.Errorf("Parse(%q) accepted, want error", in)
		}
	}
}
