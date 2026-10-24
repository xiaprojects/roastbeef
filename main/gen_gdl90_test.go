/*
	gen_gdl90_test.go: requirements-style unit tests for GDL90 message framing
	(prepareMessage, crcCompute) in gen_gdl90.go.

	Every GDL90 message the EFB receives goes through this framing, so it is checked
	against the ICD's own worked heartbeat example and, exhaustively, for the one
	property a receiver depends on: the flag byte never appears inside a frame.
*/

package main

import (
	"bytes"
	"testing"
)

// gdl90Payload strips the flags, byte stuffing and CRC from one framed GDL90 message
// and fails the test if the CRC does not match.
func gdl90Payload(t *testing.T, framed []byte) []byte {
	t.Helper()
	if len(framed) < 4 || framed[0] != 0x7E || framed[len(framed)-1] != 0x7E {
		t.Fatalf("not a framed message: % X", framed)
	}
	var b []byte
	for i := 1; i < len(framed)-1; i++ {
		if framed[i] == 0x7D {
			i++
			b = append(b, framed[i]^0x20)
			continue
		}
		b = append(b, framed[i])
	}
	payload, crc := b[:len(b)-2], uint16(b[len(b)-2])|uint16(b[len(b)-1])<<8
	if crcCompute(payload) != crc {
		t.Fatalf("CRC %04X; want %04X", crc, crcCompute(payload))
	}
	return payload
}

// gdl90Frames splits a buffer holding several framed messages back to back (as one
// sendGDL90 call can carry) into their payloads.
func gdl90Frames(t *testing.T, stream []byte) (payloads [][]byte) {
	t.Helper()
	for len(stream) > 0 {
		end := bytes.IndexByte(stream[1:], 0x7E) + 2
		if end < 2 {
			t.Fatalf("unterminated frame: % X", stream)
		}
		payloads = append(payloads, gdl90Payload(t, stream[:end]))
		stream = stream[end:]
	}
	return
}

// gdl90LatLng reads a 24-bit two's-complement latitude or longitude field, degrees.
func gdl90LatLng(b []byte) float64 {
	v := int32(uint32(b[0])<<24|uint32(b[1])<<16|uint32(b[2])<<8) >> 8
	return float64(v) * 180 / (1 << 23)
}

// The heartbeat example of the GDL90 ICD frames to exactly the bytes it lists: the
// CRC-CCITT of the payload, low byte first, between two 0x7E flags.
func TestPrepareMessageMatchesGDL90HeartbeatExample(t *testing.T) {
	crcInit()
	got := prepareMessage([]byte{0x00, 0x81, 0x41, 0xDB, 0xD0, 0x08, 0x02})
	want := []byte{0x7E, 0x00, 0x81, 0x41, 0xDB, 0xD0, 0x08, 0x02, 0xB3, 0x8B, 0x7E}
	if !bytes.Equal(got, want) {
		t.Fatalf("framed % X; want % X", got, want)
	}
}

// Flag (0x7E) and control-escape (0x7D) bytes in the payload are sent as 0x7D
// followed by the byte XOR 0x20.
func TestPrepareMessageEscapesFlagAndEscapeBytes(t *testing.T) {
	crcInit()
	got := prepareMessage([]byte{0x14, 0x7E, 0x7D, 0x5E})
	if !bytes.HasPrefix(got, []byte{0x7E, 0x14, 0x7D, 0x5E, 0x7D, 0x5D, 0x5E}) {
		t.Fatalf("framed % X; want 7E 14 7D 5E 7D 5D 5E ...", got)
	}
}

// For every two-byte payload, the CRC included, no 0x7E appears between the flags,
// and the frame unstuffs to the payload with a matching CRC. So a receiver that
// splits the stream on 0x7E never cuts a message short.
func TestPrepareMessageNeverEmbedsAFlag(t *testing.T) {
	crcInit()
	for i := 0; i < 1<<16; i++ {
		payload := []byte{byte(i >> 8), byte(i)}
		framed := prepareMessage(append([]byte(nil), payload...))
		if bytes.IndexByte(framed[1:len(framed)-1], 0x7E) >= 0 {
			t.Fatalf("payload % X: flag inside frame % X", payload, framed)
		}
		if got := gdl90Payload(t, framed); !bytes.Equal(got, payload) {
			t.Fatalf("payload % X came back as % X", payload, got)
		}
	}
}
