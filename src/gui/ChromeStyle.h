/* Copyright 2026 the SumatraPDF project authors (see AUTHORS file).
   License: Simplified BSD (see COPYING.BSD) */

#ifndef SUMATRA_CHROME_STYLE_H
#define SUMATRA_CHROME_STYLE_H

int ThemeGetCurrentIndex();
bool IsCurrentThemeDefault();
bool ThemeUsesHighContrastColors();
Color ThemeInactiveTabBackgroundColor();
Color ThemeActiveTabBackgroundColor();
Color ThemeWindowTextColor();

namespace ChromeStyle {
constexpr int captionGlyph = 10;
constexpr int tabRadius = 10;
constexpr int tabFoot = 12;
constexpr int tabTop = 5;
constexpr int feedbackSize = 28;
constexpr int closeHit = 24;
constexpr int inactiveAlpha = 102;

inline bool HighContrast() {
    return ThemeUsesHighContrastColors();
}

inline bool CustomPalette() {
    return ThemeGetCurrentIndex() > 1 || (ThemeGetCurrentIndex() == 0 && !IsCurrentThemeDefault());
}

inline Color Bar(bool light) {
    if (CustomPalette()) {
        return ThemeInactiveTabBackgroundColor();
    }
    return HighContrast() ? GetSysColor(COLOR_WINDOW) : (light ? MkRgb(0xD3, 0xE3, 0xFD) : MkRgb(0x20, 0x21, 0x24));
}

inline Color Surface(bool light) {
    if (CustomPalette()) {
        return ThemeActiveTabBackgroundColor();
    }
    return HighContrast() ? GetSysColor(COLOR_WINDOW) : (light ? kColWhite : MkRgb(0x35, 0x36, 0x3A));
}

inline Color Text(bool light) {
    if (CustomPalette()) {
        return ThemeWindowTextColor();
    }
    return HighContrast() ? GetSysColor(COLOR_WINDOWTEXT) : (light ? kColBlack : kColWhite);
}

inline Color Overlay(Color bg, Color fg, int alpha) {
    return MkRgb((u8)((GetRValue(bg) * (255 - alpha) + GetRValue(fg) * alpha + 127) / 255),
                 (u8)((GetGValue(bg) * (255 - alpha) + GetGValue(fg) * alpha + 127) / 255),
                 (u8)((GetBValue(bg) * (255 - alpha) + GetBValue(fg) * alpha + 127) / 255));
}

inline int StrokePx() {
    return std::max(1, (int)lroundf((float)DpiScale(100) / 100.0f));
}
} // namespace ChromeStyle

#endif
