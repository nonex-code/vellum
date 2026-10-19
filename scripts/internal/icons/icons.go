// Package icons holds the small, dependency-free image helpers shared by the
// asset generators under scripts/. It deliberately uses only the Go standard
// library so the generators run on any platform without external image tools.
package icons

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
)

// ContainSquare scales src to fit inside a size×size transparent canvas,
// preserving aspect ratio and centering it.
func ContainSquare(src image.Image, size int) *image.RGBA {
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	sb := src.Bounds()
	sw, sh := sb.Dx(), sb.Dy()
	if sw == 0 || sh == 0 {
		return out
	}
	scale := math.Min(float64(size)/float64(sw), float64(size)/float64(sh))
	nw := maxInt(int(math.Round(float64(sw)*scale)), 1)
	nh := maxInt(int(math.Round(float64(sh)*scale)), 1)
	scaled := Resize(src, nw, nh)
	offx := (size - nw) / 2
	offy := (size - nh) / 2
	draw.Draw(out, image.Rect(offx, offy, offx+nw, offy+nh), scaled, scaled.Bounds().Min, draw.Src)
	return out
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// Resize returns a w×h bilinear-resampled copy of src. Channel values are
// interpolated in premultiplied space (using image.Color.RGBA's 16-bit
// premultiplied components) and then un-premultiplied, so downscaling keeps
// clean, non-darkened edges — important for a logo's transparency.
func Resize(src image.Image, w, h int) *image.RGBA {
	b := src.Bounds()
	iw, ih := b.Dx(), b.Dy()
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	if iw == 0 || ih == 0 {
		return out
	}
	for y := 0; y < h; y++ {
		fy := (float64(y)+0.5)*float64(ih)/float64(h) - 0.5
		y0 := clampInt(int(math.Floor(fy)), 0, ih-1)
		yf := fy - math.Floor(fy)
		y1 := clampInt(y0+1, 0, ih-1)
		for x := 0; x < w; x++ {
			fx := (float64(x)+0.5)*float64(iw)/float64(w) - 0.5
			x0 := clampInt(int(math.Floor(fx)), 0, iw-1)
			xf := fx - math.Floor(fx)
			x1 := clampInt(x0+1, 0, iw-1)

			c00 := premul(src.At(b.Min.X+x0, b.Min.Y+y0))
			c10 := premul(src.At(b.Min.X+x1, b.Min.Y+y0))
			c01 := premul(src.At(b.Min.X+x0, b.Min.Y+y1))
			c11 := premul(src.At(b.Min.X+x1, b.Min.Y+y1))

			pr := lerp(c00.r, c10.r, xf, c01.r, c11.r, yf)
			pg := lerp(c00.g, c10.g, xf, c01.g, c11.g, yf)
			pb := lerp(c00.b, c10.b, xf, c01.b, c11.b, yf)
			pa := lerp(c00.a, c10.a, xf, c01.a, c11.a, yf)

			a8 := uint8(pa / 256)
			var r8, g8, b8 uint8
			if pa > 0 {
				r8 = uint8((pr * 65535 / pa) / 256)
				g8 = uint8((pg * 65535 / pa) / 256)
				b8 = uint8((pb * 65535 / pa) / 256)
			}
			out.SetRGBA(x, y, color.RGBA{r8, g8, b8, a8})
		}
	}
	return out
}

type px struct{ r, g, b, a uint32 }

func premul(c color.Color) px {
	r, g, b, a := c.RGBA()
	return px{r, g, b, a}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func lerp(a, b uint32, xf float64, c, d uint32, yf float64) float64 {
	fa, fb, fc, fd := float64(a), float64(b), float64(c), float64(d)
	top := (fa + (fb-fa)*xf) + ((fc+(fd-fc)*xf)-(fa+(fb-fa)*xf))*yf
	return top
}

// PNGOf encodes im as PNG bytes.
func PNGOf(im image.Image) []byte {
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		panic(err)
	}
	return b.Bytes()
}
