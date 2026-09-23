/* Copyright 2024 the SumatraPDF project authors (see AUTHORS file).
   License: GPLv3 */

#include "base/Base.h"
#include "base/WinDynCalls.h"
#include "base/Win.h"
#include "base/Pixmap.h"
#include "base/UITask.h"

#include "gui/Dpi.h"
#include "gui/UIModels.h"
#include "gui/Layout.h"
#include "gui/win/WinGui.h"
#include "gui/PlatformFont.h"
#include "gui/Gfx.h"
#include "gui/GuiColors.h"
#include "gui/VirtCtrl.h"
#include "gui/VirtHost.h"

#include "Settings.h"
#include "AppSettings.h"
#include "DocController.h"
#include "EngineBase.h"
#include "ProgressUpdateUI.h"
#include "TextSelection.h"
#include "TextSearch.h"
#include "DisplayModel.h"
#include "SumatraPDF.h"
#include "MainWindow.h"
#include "Commands.h"
#include "Accelerators.h"
#include "SvgIcons.h"
#include "Toolbar.h"
#include "SearchAndDDE.h"
#include "FindWindow.h"
#include "Translations.h"
#include "Theme.h"
#include "DarkMode.h"
#include "FindBar.h"

constexpr int kFindBarGap = 4;
constexpr int kFindBarDefaultEditDx = 240;

namespace {

struct FindStatusBox : ILayout {
    ILayout* child = nullptr;
    int dx = 0;

    FindStatusBox(ILayout* c, int dxIn);
    ~FindStatusBox() override;

    Size Layout(Constraints bc) override;
    int MinIntrinsicHeight(int width) override;
    int MinIntrinsicWidth(int height) override;
    void SetBounds(Rect) override;
    int LayoutChildCount() override;
    ILayout* LayoutChildAt(int) override;
};

FindStatusBox::FindStatusBox(ILayout* c, int dxIn) {
    child = c;
    dx = dxIn;
}

FindStatusBox::~FindStatusBox() {
    delete child;
}

int FindStatusBox::LayoutChildCount() {
    return child ? 1 : 0;
}

ILayout* FindStatusBox::LayoutChildAt(int) {
    return child;
}

int FindStatusBox::MinIntrinsicWidth(int) {
    return dx;
}

int FindStatusBox::MinIntrinsicHeight(int width) {
    return child ? child->MinIntrinsicHeight(width) : 0;
}

Size FindStatusBox::Layout(const Constraints bc) {
    int w = MinIntrinsicWidth(0);
    if (bc.min.dx > w) {
        w = bc.min.dx;
    }
    if (bc.HasBoundedWidth() && bc.max.dx < w) {
        w = bc.max.dx;
    }
    Size s = child ? child->Layout(bc.TightenWidth(w)) : Size{};
    return {w, s.dy};
}

void FindStatusBox::SetBounds(Rect r) {
    lastBounds = r;
    if (child) {
        child->SetBounds(r);
    }
}

} // namespace

static int DecimalDigits(int n) {
    int digits = 1;
    while (n >= 10) {
        n /= 10;
        digits++;
    }
    return digits;
}

int FindStatusDx(PlatformFont* font, int totalHits, bool capped) {
    int digits = DecimalDigits(std::max(totalHits, 0));
    int nChars = (2 * digits) + 3; // N, " / ", M
    if (capped) {
        nChars++; // the trailing '+' in e.g. "999 / 999+"
    }
    return font ? nChars * font->averageCharWidth : 0;
}

struct FindBarWnd {
    MainWindow* win = nullptr;
    DropDown* edit = nullptr;
    VirtText* status = nullptr;
    FindStatusBox* statusBox = nullptr;
    int statusTotalHits = 0;
    bool statusCapped = false;
    VirtIconButton* btns[4]{};
    bool suppressTextChanged = false;

    bool UpdateStatusWidth(int totalHits, bool capped);
};

bool FindBarWnd::UpdateStatusWidth(int totalHits, bool capped) {
    if (!statusBox || totalHits < 0) {
        return false;
    }
    int dx = FindStatusDx(status ? status->font : nullptr, totalHits, capped);
    if (statusBox->dx == dx) {
        return false;
    }
    statusBox->dx = dx;
    statusTotalHits = totalHits;
    statusCapped = capped;
    return true;
}

static TempStr AppendCmdAccel(Str base, int cmd) {
    TempStr accel = AppendAccelKeyToMenuStringTemp({}, cmd);
    if (len(accel) == 0) {
        return base;
    }
    return str::JoinTemp(base, fmt(" (%s)", Str(accel.s + 1, len(accel) - 1)));
}

static TempStr FindBarButtonTooltip(int cmd) {
    switch (cmd) {
        case CmdFindPrev:
            return AppendCmdAccel(Tr("Find Previous"), cmd);
        case CmdFindNext:
            return AppendCmdAccel(Tr("Find Next"), cmd);
        case CmdFindToggleMatchCase:
            return AppendCmdAccel(Tr("Match Case"), cmd);
        case CmdFindToggleMatchWholeWord:
            return AppendCmdAccel(Tr("Match Whole Word"), cmd);
    }
    return {};
}

static void OnFindEditChanged(MainWindow* win) {
    if (!win || !win->findBar || win->findBar->suppressTextChanged) {
        return;
    }
    OnFindBarTextChanged(win);
}

namespace {
struct PickedTermData {
    MainWindow* win = nullptr;
    Str term;
    ~PickedTermData() { str::Free(term); }
};
} // namespace

static void StartPickedFindTask(PickedTermData* d) {
    AutoDelete del(d);
    MainWindow* win = d->win;
    if (!IsMainWindowValidAndNotClosing(win) || !win->findEdit) {
        return;
    }
    if (!str::Eq(win->findEdit->GetTextTemp(), d->term)) {
        win->findEdit->SetText(d->term);
    }
    CbEditSetModified(win->findEdit, false);
    FindTextOnThread(win, TextSearch::Direction::Forward, d->term, true, false);
}

void StartPickedFindTerm(MainWindow* win, Str term) {
    if (!win || len(term) == 0) {
        return;
    }
    auto* d = new PickedTermData;
    d->win = win;
    d->term = str::Dup(term);
    uitask::Post(MkFunc0<PickedTermData>(StartPickedFindTask, d), "TaskFindHistoryPick");
}

static void OnFindEditCloseUp(MainWindow* win) {
    if (!win || !win->findBar || win->findBar->suppressTextChanged || !win->findBar->edit) {
        return;
    }
    int idx = CbGetCurrentSelection(win->findBar->edit);
    if (idx < 0 || idx >= len(win->findBar->edit->items)) {
        return;
    }
    StartPickedFindTerm(win, win->findBar->edit->items[idx]);
}

static void FindBarButtonClicked(MainWindow* win, VirtMouseEvent* ev) {
    auto* btn = (VirtIconButton*)ev->target;
    if (!btn || !win) {
        return;
    }
    int cmd = btn->id;
    switch (cmd) {
        case CmdFindPrev:
            FindPrev(win);
            break;
        case CmdFindNext:
            FindNext(win);
            break;
        case CmdFindToggleMatchCase:
            FindToggleMatchCase(win);
            break;
        case CmdFindToggleMatchWholeWord:
            FindToggleMatchWholeWord(win);
            break;
        default:
            return;
    }
    ev->didHandle = true;
}

static LRESULT CALLBACK FindEditSubclassProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR refData) {
    auto* win = (MainWindow*)refData;
    if (msg == WM_KEYDOWN) {
        if (wp == 'F' && IsCtrlPressed() && !IsAltPressed()) {
            FocusFindEditSelectAll(win);
            return 0;
        }
        if (wp == VK_RETURN) {
            if (FindFlushPendingSearch(win)) {
                return 0;
            }
            if (IsShiftPressed()) {
                FindPrev(win);
            } else {
                FindNext(win);
            }
            return 0;
        }
        if (wp == VK_ESCAPE) {
            HideFindBar(win);
            return 0;
        }
    }
    return DefSubclassProc(hwnd, msg, wp, lp);
}

ILayout* BuildFindToolbarRow(MainWindow* win) {
    if (!win) {
        return nullptr;
    }
    ToolbarVirt* tb = win->toolbarVirt;
    if (!tb || !tb->host) {
        return nullptr;
    }
    FindBarWnd* bar = win->findBar;
    if (!bar) {
        bar = new FindBarWnd();
        win->findBar = bar;
    }
    bar->win = win;

    int cyPad = DpiScale(4);
    int iconPad = DpiScale(4);
    Color fg = TbTextColor();
    Color dis = TbDisabledColor();

    auto colBg = ThemeWindowControlBackgroundColor();
    auto colTxt = ThemeWindowTextColor();

    DropDown::CreateArgs args;
    args.parent = win->hwndToolbar;
    args.font = tb->platformFont ? tb->platformFont : GetAppFont();
    args.isRtl = IsUIRtl();
    args.isEditable = true;
    auto* edit = new DropDown();
    edit->SetColors(colTxt, colBg);
    edit->Create(args);
    CbSetCueBanner(edit, Tr("Find"));
    edit->mapRtlX = true;
    int editDx = DpiScale(kFindBarDefaultEditDx);
    edit->idealDx = editDx;
    edit->maxDx = editDx;
    edit->onTextChanged = MkFunc0(OnFindEditChanged, win);
    edit->onCloseUp = MkFunc0(OnFindEditCloseUp, win);
    HWND hInnerEdit = CbEditHwnd(edit->hwnd);
    if (hInnerEdit) {
        SetWindowSubclass(hInnerEdit, FindEditSubclassProc, 1, (DWORD_PTR)win);
    }
    ApplyFindHistory(edit);
    // hidden until the row is shown, else it sits at (0,0) over the toolbar
    edit->SetVisibility(Visibility::Collapse);
    bar->edit = edit;
    if (!win->findEdit) {
        win->findEdit = edit;
    }

    auto* status = NewVirtText({
        .font = tb->platformFont ? tb->platformFont : GetAppFont(),
        .isRtl = IsUIRtl(),
        .ellipsis = true,
    });
    status->SetColor(kColText, fg);
    bar->status = status;
    bar->statusBox = new FindStatusBox(status, FindStatusDx(status->font, bar->statusTotalHits, bar->statusCapped));

    static const int cmds[] = {CmdFindPrev, CmdFindNext, CmdFindToggleMatchCase, CmdFindToggleMatchWholeWord};
    static const char* icons[] = {gIconChevronUp, gIconChevronDown, gIconMatchCase, gIconMatchWholeWord};
    static_assert(dimof(cmds) == dimof(bar->btns) && dimof(icons) == dimof(bar->btns));
    for (int i = 0; i < dimofi(cmds); i++) {
        auto* b = new VirtIconButton();
        b->id = cmds[i];
        b->padding = Insets{cyPad, iconPad, cyPad, iconPad};
        b->pixmap = GetCachedPixmapForSvg(Str(icons[i]), tb->iconSize, tb->iconSize, fg, TbBgColor());
        b->pixmapDisabled = GetCachedPixmapForSvg(Str(icons[i]), tb->iconSize, tb->iconSize, dis, TbBgColor());
        ApplyToolbarItemColors(b);
        b->SetTooltip(FindBarButtonTooltip(cmds[i]));
        b->onClick = MkFunc1(FindBarButtonClicked, win);
        bar->btns[i] = b;
        VecAppend(tb->findItems, (VirtCtrl*)b);
    }

    auto* row = new HBox();
    row->alignMain = MainAxisAlign::MainCenter;
    row->alignCross = CrossAxisAlign::CrossCenter;
    row->rtl = IsUIRtl();
    row->gap = DpiScale(kFindBarGap);
    row->AddChild(edit);
    row->AddChild(bar->statusBox);
    for (VirtIconButton* b : bar->btns) {
        row->AddChild(b);
    }

    int p = DpiScale(4);
    auto* padLayout = new Padding(row, Insets{0, p, 0, p});
    padLayout->SetVisibility(Visibility::Collapse);
    return padLayout;
}

FindBarWnd* CreateFindBar(MainWindow* win) {
    if (!win) {
        return nullptr;
    }
    if (win->findBar) {
        return win->findBar;
    }
    auto* bar = new FindBarWnd();
    bar->win = win;
    return bar;
}

void DeleteFindBar(MainWindow* win) {
    if (!win || !win->findBar) {
        return;
    }
    FindBarWnd* bar = win->findBar;
    win->findBar = nullptr;
    if (win->findEdit == bar->edit) {
        win->findEdit = nullptr;
    }
    delete bar;
}

void FindBarUpdateDpi(MainWindow*) {
    // Toolbar recreation handles this automatically via ReCreateToolbar
}

int FindBarFontHeight(MainWindow* win) {
    if (!win || !win->findBar || !win->findBar->edit) {
        return 0;
    }
    return PlatformFontLineHeight(win->findBar->edit->GetFont());
}

int FindBarWindowHeight(MainWindow* win) {
    ToolbarVirt* tb = win ? win->toolbarVirt : nullptr;
    if (!tb || !tb->findRow || tb->findRow->GetVisibility() != Visibility::Visible) {
        return 0;
    }
    return tb->rowDy;
}

void RecreateFindBar(MainWindow*) {
    // Toolbar recreation handles this automatically
}

static void ShowCompactBar(MainWindow* win) {
    TempStr term = CurrentFindTermTemp(win);
    ToolbarVirt* tb = win ? win->toolbarVirt : nullptr;
    if (!tb || !tb->findRow) {
        return;
    }
    SetFindRowVisible(win, true);
    FindBarWnd* bar = win->findBar;
    if (bar && bar->edit) {
        win->findEdit = bar->edit;
        win->findPagesEdit = nullptr;
        if (len(term) > 0 && CbGetTextLen(win->findEdit) == 0) {
            bar->suppressTextChanged = true;
            win->findEdit->SetText(term);
            bar->suppressTextChanged = false;
        }
        FindBarSetMatchCaseChecked(win, win->findMatchCase);
        FindBarSetMatchWholeWordChecked(win, win->findMatchWholeWord);
        win->findEdit->SetFocus();
        CbEditSelectAll(win->findEdit);
    }
}

void ShowFindBar(MainWindow* win) {
    if (gSettings->searchUIFloating) {
        ShowFindWindow(win);
        return;
    }
    ShowCompactBar(win);
}

void HideFindBar(MainWindow* win) {
    ClearFindMatches(win);
    if (win->ctrl) {
        win->ctrl->FindClear();
    }
    if (DisplayModel* dm = win->AsFixed()) {
        if (dm->textSearch) {
            dm->textSearch->Reset();
        }
    }
    if (IsFindWindowVisible(win)) {
        HideFindWindow(win);
        return;
    }
    SetFindRowVisible(win, false);
    AbortFinding(win, true);
    HwndSetFocus(win->hwndFrame);
    ScheduleRepaint(win, 0);
}

bool IsFindBarVisible(MainWindow* win) {
    if (gSettings->searchUIFloating) {
        return IsFindWindowVisible(win);
    }
    ToolbarVirt* tb = win ? win->toolbarVirt : nullptr;
    return tb && tb->findRow && tb->findRow->GetVisibility() == Visibility::Visible;
}

bool IsFindUIVisible(MainWindow* win) {
    return IsFindBarVisible(win) || IsFindWindowVisible(win);
}

void FocusFindEditSelectAll(MainWindow* win) {
    if (!win || !win->findEdit) {
        return;
    }
    win->findEdit->SetFocus();
    CbEditSelectAll(win->findEdit);
}

void FindBarSyncHistory(MainWindow* win) {
    if (win && win->findBar && win->findBar->edit) {
        ApplyFindHistory(win->findBar->edit);
    }
}

void ToggleFloatingFindUI(MainWindow* win) {
    struct FindUiSwitchState {
        MainWindow* win = nullptr;
        Str text;
        Str pages;
        int selStart = 0;
        int selEnd = 0;
        bool hasText = false;
    };
    Vec<FindUiSwitchState> states;
    for (MainWindow* w : gWindows) {
        if (!IsFindUIVisible(w)) {
            continue;
        }
        FindUiSwitchState state;
        state.win = w;
        if (w->findEdit) {
            state.hasText = true;
            state.text = str::Dup(w->findEdit->GetTextTemp());
            CbEditGetSelection(w->findEdit, state.selStart, state.selEnd);
        }
        if (w->findPagesEdit) {
            state.pages = str::Dup(w->findPagesEdit->GetTextTemp());
        }
        VecAppend(states, state);
    }

    for (FindUiSwitchState& state : states) {
        HideFindBar(state.win);
    }

    gSettings->searchUIFloating = !gSettings->searchUIFloating;
    ScheduleSaveSettings();

    auto restore = [](FindUiSwitchState& state) {
        MainWindow* w = state.win;
        ShowFindBar(w);
        if (state.hasText && w->findEdit) {
            w->findEdit->SetText(state.text);
        }
        if (len(state.pages) > 0 && w->findPagesEdit) {
            w->findPagesEdit->SetText(state.pages);
        }
        if (w->findEdit && (state.selStart != state.selEnd)) {
            CbEditSelectText(w->findEdit, state.selStart, state.selEnd);
        }
    };

    for (FindUiSwitchState& state : states) {
        if (state.win != win) {
            restore(state);
        }
    }
    for (FindUiSwitchState& state : states) {
        if (state.win == win) {
            restore(state);
        }
        str::Free(state.text);
        str::Free(state.pages);
    }
}

TempStr FindUiStateResultTemp(Str action, int* exitCodeOut) {
    str::Builder out;
    auto finish = [&](int code) -> Str {
        if (exitCodeOut) {
            *exitCodeOut = code;
        }
        return ToStrTemp(out);
    };
    if (len(gWindows) == 0) {
        out.Append(StrL("ERROR no-window\n"));
        return finish(1);
    }
    if (str::Eq(action, StrL("show-all"))) {
        for (MainWindow* w : gWindows) {
            ShowFindBar(w);
        }
    } else if (str::Eq(action, StrL("toggle-first"))) {
        ToggleFloatingFindUI(gWindows[0]);
    } else if (str::Eq(action, StrL("set-first-text"))) {
        if (gWindows[0]->findEdit) {
            gWindows[0]->findEdit->SetText(StrL("stale-term"));
        }
    } else if (str::Eq(action, StrL("clear-first"))) {
        if (gWindows[0]->findEdit) {
            gWindows[0]->findEdit->SetText(StrL(""));
        }
    } else if (str::Eq(action, StrL("hide-first"))) {
        HideFindBar(gWindows[0]);
    } else if (str::Eq(action, StrL("theme-recreate-first"))) {
        RecreateFindBar(gWindows[0]);
    } else if (!str::Eq(action, StrL("state"))) {
        out.Append(StrL("ERROR invalid action\n"));
        return finish(1);
    }
    int docs = 0;
    int compact = 0;
    int floating = 0;
    for (MainWindow* w : gWindows) {
        docs += w->IsDocLoaded() ? 1 : 0;
        compact += IsFindBarVisible(w) ? 1 : 0;
        floating += IsFindWindowVisible(w) ? 1 : 0;
    }
    int firstTextLen = gWindows[0]->findEdit ? CbGetTextLen(gWindows[0]->findEdit) : -1;
    out.Append(fmt("OK windows=%d docs=%d pref=%d compact=%d floating=%d firstTextLen=%d\n", len(gWindows), docs,
                   gSettings->searchUIFloating ? 1 : 0, compact, floating, firstTextLen));
    return finish(0);
}

void FindBarReposition(MainWindow* win) {
    if (!IsFindBarVisible(win)) {
        return;
    }
    if (!NeedsFindUI(win)) {
        HideFindBar(win);
    }
}

// Must run before the toolbar relayout: a collapsed HwndSlot is not moved.
void FindBarSetEditVisible(MainWindow* win, bool visible) {
    if (!win || !win->findBar || !win->findBar->edit) {
        return;
    }
    win->findBar->edit->SetVisibility(visible ? Visibility::Visible : Visibility::Collapse);
}

void FindBarSetStatus(MainWindow* win, Str s, int totalHits) {
    if (gSettings->searchUIFloating) {
        FindWindowSetStatus(win, s, totalHits);
        return;
    }
    FindBarWnd* bar = win ? win->findBar : nullptr;
    if (!bar || !bar->status) {
        return;
    }
    Str text = s ? s : StrL("");
    bool capped = str::EndsWith(text, StrL("+"));
    bool widthChanged = bar->UpdateStatusWidth(totalHits, capped);
    bar->status->SetText(text);
    ToolbarVirt* tb = win->toolbarVirt;
    if (tb && tb->host) {
        if (widthChanged) {
            tb->host->Relayout();
        }
        tb->host->Invalidate(true);
    }
}

constexpr int kBtnMatchCase = 2;
constexpr int kBtnMatchWholeWord = 3;

static void FindBarSetBtnChecked(MainWindow* win, int idx, bool checked) {
    if (!win || !win->findBar) {
        return;
    }
    VirtIconButton* b = win->findBar->btns[idx];
    if (!b || b->isSelected == checked) {
        return;
    }
    b->isSelected = checked;
    b->Invalidate();
}

void FindBarSetMatchCaseChecked(MainWindow* win, bool checked) {
    if (gSettings->searchUIFloating) {
        FindWindowSetMatchCaseChecked(win, checked);
        return;
    }
    FindBarSetBtnChecked(win, kBtnMatchCase, checked);
}

void FindBarSetMatchWholeWordChecked(MainWindow* win, bool checked) {
    if (gSettings->searchUIFloating) {
        FindWindowSetMatchWholeWordChecked(win, checked);
        return;
    }
    FindBarSetBtnChecked(win, kBtnMatchWholeWord, checked);
}
