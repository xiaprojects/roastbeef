/*
	uatparse_test.go: requirements-style unit tests for the UAT uplink
	(FIS-B) parser. The golden frame is a real 978 MHz uplink captured in
	test-data/cyoung-09062015-noproblem-stratux-uat.log (dump978 output
	format: '+' + 432 bytes as hex, then ';key=value' demodulation metadata).
*/

package uatparse

import (
	"strings"
	"testing"
)

// One real uplink from a ground station at 42.29°N 84.03°W carrying two
// METAR text products (product id 413).
const goldenUplink = "+3c2643887cdcab801f00067457403455014a02c1492830db2c75c9a832c70c722d48374cd803312833cefc79801cf0c3181234b8013f2813310c75d6079c114c33cb8c31e39f5e742080067453803455014a02cd517830db2c35d9a8015543e0c704cd803312832defc79801cb9e7481234b8013f2813310c75c2079c114c32db7c31e74835e30c77f5e740000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000;rs=13;"

// A well-formed uplink decodes to the ground-station position and the
// text reports it carries, byte-exact.
func TestDecodeGoldenUplink(t *testing.T) {
	m, err := New(goldenUplink)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if m.RS_Err != 13 || m.SignalStrength != -1 {
		t.Errorf("metadata: rs=%d ss=%d; want rs=13, ss=-1 (absent)", m.RS_Err, m.SignalStrength)
	}
	if err := m.DecodeUplink(); err != nil {
		t.Fatalf("DecodeUplink: %v", err)
	}
	if m.Lat < 42.29 || m.Lat > 42.30 || m.Lon < -84.04 || m.Lon > -84.03 {
		t.Errorf("station position = %.4f, %.4f; want 42.2926, -84.0321", m.Lat, m.Lon)
	}
	if len(m.Frames) != 2 {
		t.Fatalf("frames = %d; want 2", len(m.Frames))
	}
	want := []struct {
		product      uint32
		length       uint32
		hours, mins  uint32
		textContains string
	}{
		{413, 58, 21, 52, "METAR KARR 062152Z 21012KT 7SM CLR 33/19 A3001"},
		{413, 61, 20, 56, "METAR KMTW 062056Z AUTO 10SM CLR 27/19 A2994"},
	}
	for i, w := range want {
		f := m.Frames[i]
		if f.Frame_type != 0 || f.Product_id != w.product || f.FISB_length != w.length || f.FISB_hours != w.hours || f.FISB_minutes != w.mins {
			t.Errorf("frame %d: type=%d product=%d len=%d time=%02d:%02d; want type=0 product=%d len=%d time=%02d:%02d",
				i, f.Frame_type, f.Product_id, f.FISB_length, f.FISB_hours, f.FISB_minutes, w.product, w.length, w.hours, w.mins)
		}
		if len(f.Text_data) == 0 || !strings.HasPrefix(f.Text_data[0], w.textContains) {
			t.Errorf("frame %d text = %q; want prefix %q", i, f.Text_data, w.textContains)
		}
	}

	reports, err := m.GetTextReports()
	if err != nil || len(reports) != 2 {
		t.Fatalf("GetTextReports = %d reports, %v; want 2, nil", len(reports), err)
	}
	// Empty text records are dropped from the aggregated list.
	for _, r := range reports {
		if len(r) == 0 {
			t.Errorf("GetTextReports returned an empty report")
		}
	}
}

// GetTextReports decodes lazily: it must work on a message that was never
// explicitly decoded, and give the same answer as after DecodeUplink.
func TestGetTextReportsDecodesLazily(t *testing.T) {
	m, err := New(goldenUplink)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	reports, err := m.GetTextReports()
	if err != nil || len(reports) != 2 {
		t.Fatalf("GetTextReports (lazy) = %d, %v; want 2, nil", len(reports), err)
	}
	again, _ := m.GetTextReports()
	if len(again) != 2 || again[0] != reports[0] || again[1] != reports[1] {
		t.Errorf("GetTextReports is not idempotent: %q vs %q", again, reports)
	}
}

// Metadata after the ';' is optional and tolerant: missing, malformed and
// unknown keys are ignored, and the defaults are -1.
func TestMetadataParsing(t *testing.T) {
	payload := strings.SplitN(goldenUplink, ";", 2)[0]
	cases := []struct {
		suffix string
		rs, ss int
	}{
		{";", -1, -1},
		{";rs=3;ss=-20;", 3, -20},
		{";ss=7", -1, 7},
		{";rs=abc;ss=", -1, -1},
		{";foo=1;rs=2", 2, -1},
	}
	for _, c := range cases {
		m, err := New(payload + c.suffix)
		if err != nil {
			t.Errorf("New(%q): %v", c.suffix, err)
			continue
		}
		if m.RS_Err != c.rs || m.SignalStrength != c.ss {
			t.Errorf("New(%q): rs=%d ss=%d; want rs=%d ss=%d", c.suffix, m.RS_Err, m.SignalStrength, c.rs, c.ss)
		}
	}
}

// Robustness: input that is not an uplink frame is rejected with an error
// and never panics.
func TestRejectsMalformedInput(t *testing.T) {
	payload := strings.SplitN(goldenUplink, ";", 2)[0]
	cases := map[string]string{
		"empty":                 "",
		"no semicolon":          payload,
		"downlink frame":        "-" + payload[1:] + ";",
		"no sign character":     payload[1:] + ";",
		"odd hex length":        payload[:len(payload)-1] + ";",
		"way too long":          payload + strings.Repeat("00", 10) + ";",
		"garbage":               "hello;world",
		"trailing CRLF garbage": "\r\n;\r\n",
	}
	for name, in := range cases {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("New(%s) panicked: %v", name, r)
				}
			}()
			if _, err := New(in); err == nil {
				t.Errorf("New(%s) accepted invalid input", name)
			}
		}()
	}
}

// Robustness: a short payload is zero-padded to the full 432-byte uplink
// length rather than rejected (dump978 can emit truncated frames), and the
// padded frame still decodes without panicking.
func TestShortPayloadIsPadded(t *testing.T) {
	payload := strings.SplitN(goldenUplink, ";", 2)[0]
	short := payload[:1+2*100] + ";" // sign + 100 bytes
	m, err := New(short)
	if err != nil {
		t.Fatalf("New(short payload): %v", err)
	}
	if len(m.msg) != UPLINK_FRAME_DATA_BYTES {
		t.Fatalf("padded length = %d; want %d", len(m.msg), UPLINK_FRAME_DATA_BYTES)
	}
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("DecodeUplink(padded frame) panicked: %v", r)
			}
		}()
		if err := m.DecodeUplink(); err != nil {
			t.Errorf("DecodeUplink(padded frame): %v", err)
		}
	}()
}

// DLAC six-bit text decoding: the alphabet is mapped exactly and the tab
// character expands to the number of spaces given by the following code.
func TestDLACDecode(t *testing.T) {
	// "METAR" in DLAC is 5 six-bit codes: M=13 E=5 T=20 A=1 R=18, packed
	// big-endian into 30 bits, then 2 bits of padding: 001101 000101 010100 000001 010010 00.
	packed := []byte{0x34, 0x55, 0x01, 0x48}
	if got := dlac_decode(packed, 4); got != "METAR" {
		t.Errorf("dlac_decode(METAR) = %q", got)
	}
	// Every alphabet position round-trips to the same rune.
	for i := 0; i < 64; i++ {
		if i == 28 { // tab: consumed as a control code, tested below
			continue
		}
		b := []byte{byte(i << 2)}
		if got := dlac_decode(b, 1); got != string(dlac_alpha[i]) {
			t.Errorf("dlac_decode(code %d) = %q; want %q", i, got, string(dlac_alpha[i]))
		}
	}
	// Tab (28) followed by 3 expands to three spaces: 011100 000011 -> 0x70 0x30.
	if got := dlac_decode([]byte{0x70, 0x30}, 2); got != "   " {
		t.Errorf("dlac_decode(tab,3) = %q; want three spaces", got)
	}
}
