#include "code_editor.h"
#include <QAbstractItemView>
#include <QCompleter>
#include <QDialog>
#include <QFontDatabase>
#include <QHBoxLayout>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QPainter>
#include <QPushButton>
#include <QRegularExpression>
#include <QScrollBar>
#include <QSignalBlocker>
#include <QStringListModel>
#include <QSyntaxHighlighter>
#include <QTextBlock>
#include <QTimer>
#include <QToolTip>
#include <QVBoxLayout>

extern "C" {
#include <lua.h>
#include <lauxlib.h>
}

class LuaHighlighter final : public QSyntaxHighlighter {
public:
    explicit LuaHighlighter(QTextDocument *document) : QSyntaxHighlighter(document) {}
protected:
    void highlightBlock(const QString &text) override
    {
        const auto mark = [this, &text](const QString &pattern, const QColor &colour) {
            const auto expression = QRegularExpression(pattern);
            auto matches = expression.globalMatch(text);
            while (matches.hasNext()) {
                const auto match = matches.next();
                setFormat(int(match.capturedStart()), int(match.capturedLength()), colour);
            }
        };
        const bool dark = qApp->palette().color(QPalette::Base).lightness() < 128;
        mark("\\b(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\\b",
            dark ? QColor("#c7b1ee") : QColor("#6a32a0"));
        mark("\\b[0-9]+(?:\\.[0-9]+)?\\b", dark ? QColor("#91c8ff") : QColor("#1759a0"));
        mark("\\bnova\\.[A-Za-z_]+", dark ? QColor("#8cdbc9") : QColor("#087363"));
        const QColor stringColour = dark ? QColor("#e6c482") : QColor("#835400");
        const QColor commentColour = dark ? QColor("#a4b5c8") : QColor("#546674");
        // Walk strings and comments last so tokens inside them are not highlighted.
        int i = 0;
        int longState = previousBlockState();
        if (longState >= 1 || longState <= -2) {
            const QString close = "]" + QString(longState >= 1 ? longState - 1 : -longState - 2, '=') + "]";
            const int end = int(text.indexOf(close));
            setFormat(0, end < 0 ? text.size() : end + close.size(), longState >= 1 ? commentColour : stringColour);
            if (end < 0) { setCurrentBlockState(longState); return; }
            i = end + close.size();
        }
        setCurrentBlockState(0);
        while (i < text.size()) {
            const bool comment = text.mid(i, 2) == "--";
            if (comment || text[i] == '[') {
                static const QRegularExpression opening("^\\[(=*)\\[");
                const int start = i + (comment ? 2 : 0);
                const auto match = opening.match(text.mid(start));
                if (match.hasMatch()) {
                    const int equals = match.captured(1).size();
                    const QString close = "]" + QString(equals, '=') + "]";
                    const int end = int(text.indexOf(close, start + match.capturedLength()));
                    setFormat(i, end < 0 ? text.size() - i : end + close.size() - i, comment ? commentColour : stringColour);
                    if (end < 0) { setCurrentBlockState(comment ? equals + 1 : -equals - 2); return; }
                    i = end + close.size();
                } else if (comment) { setFormat(i, text.size() - i, commentColour); return; }
                else ++i;
            } else if (text[i] == '\'' || text[i] == '"') {
                const auto quote = text[i];
                const int start = i++;
                while (i < text.size()) {
                    if (text[i] == '\\') i += 2;
                    else if (text[i++] == quote) break;
                }
                setFormat(start, std::min(i, int(text.size())) - start, stringColour);
            } else ++i;
        }
    }
};

class LineNumbers final : public QWidget {
public:
    explicit LineNumbers(CodeEditor *editor) : QWidget(editor), editor_(editor) {}
    QSize sizeHint() const override { return {editor_->numberAreaWidth(), 0}; }
protected:
    void paintEvent(QPaintEvent *event) override { editor_->paintNumbers(event); }
private:
    CodeEditor *editor_;
};

const QVector<LuaReference> &CodeEditor::reference()
{
    static const QVector<LuaReference> entries = {
        {"nova.object", "nova.object(id)", "Manifest v3: obtain an opaque handle by stable scene ID. Handles belong to this loaded preview, not to the document or a later reload."},
        {"nova.position", "nova.position(object) -> x, y, z", "Read the disposable runtime position of a scene object. The saved visual scene is unchanged."},
        {"nova.set_position", "nova.set_position(object, x, y, z)", "Move a runtime scene object. Values must be finite and within +/-10000. 2D objects require Z=0. Stop discards runtime changes."},
        {"nova.asset", "nova.asset(id)", "Look up a declared sprite, model or audio asset. IDs are case-sensitive; unknown references are errors."},
        {"nova.scene", "nova.scene(\"2d\" | \"3d\" | \"mixed\")", "Choose dimension for legacy Lua scenes. A v3 visual scene owns its dimension; Lua cannot silently change it."},
        {"nova.background", "nova.background(r, g, b)", "Set the native world background. RGB channels are integers 0..255."},
        {"nova.rectangle", "nova.rectangle(x, y, width, height, r, g, b)", "Draw a rectangle in the ordered native HUD/2D layer. Coordinates are logical 960x540 units; sizes must be positive."},
        {"nova.sprite", "nova.sprite(spriteOrFrames, x, y, width, height)", "Draw the whole PNG or current sprite-animation frame using nearest filtering and alpha blending."},
        {"nova.model", "nova.model(model, x, y, z, scale)", "Draw a validated static GLB with positive uniform scale. Requires 3D/mixed mode. No skeletal animation or PBR."},
        {"nova.cube", "nova.cube(x, y, z, width, height, depth, r, g, b)", "Draw a centered native generated cube. Requires 3D/mixed mode."},
        {"nova.camera", "nova.camera(x, y, z, targetX, targetY, targetZ, fov)", "Set the game camera. +Y is up. FOV is 10..120 degrees; direction cannot be parallel to the up axis."},
        {"nova.text", "nova.text(text, x, y, size, r, g, b)", "Draw game HUD text with the existing bitmap font (191-byte limit and limited glyph coverage). Studio's Unicode editor is separate."},
        {"nova.overlap", "nova.overlap(ax, ay, aw, ah, bx, by, bw, bh)", "Return whether two 2D rectangles overlap. Touching edges are not overlap. This is not a physics system."},
        {"nova.timer", "nova.timer(seconds [, repeat])", "Create a simulation-clock timer. Duration 1/60..3600 seconds. A scene shares a budget of 64 timer/tween/frame handles."},
        {"nova.timer_poll", "nova.timer_poll(timer)", "Consume and return pending expirations. Timers advance only on successful simulation ticks, not UI time."},
        {"nova.tween", "nova.tween(from, to, seconds [, easing])", "Create a numeric tween with linear or smooth easing."},
        {"nova.tween_value", "nova.tween_value(tween) -> value, done", "Read the current tween value and completion flag."},
        {"nova.frames", "nova.frames({sprites...}, secondsPerFrame [, loop])", "Create playback for 1..32 sprite handles; pass it to nova.sprite."},
        {"nova.cancel", "nova.cancel(timerOrPlayback)", "Release a timer/tween/frame handle. Further use is an explicit error."},
        {"nova.play", "nova.play(audio, volume [, loop])", "Play a declared PCM WAV. Volume 0..1. Native effects dispatch only after a successful Lua call."},
        {"nova.stop", "nova.stop(audio)", "Stop the shared native sound and its loop."},
        {"nova.save_get", "nova.save_get(key)", "v2/v3 project identity required. Read a bounded project save string, or nil if missing. Errors are not silently treated as missing."},
        {"nova.save_set", "nova.save_set(key, binaryString)", "Queue an atomic project-owned save of up to 4096 bytes. No filesystem paths or automatic table serialization."},
    };
    return entries;
}

CodeEditor::CodeEditor(QWidget *parent) : QPlainTextEdit(parent),
    completer_(new QCompleter(this)), diagnosticTimer_(new QTimer(this)), numbers_(new LineNumbers(this))
{
    setObjectName("luaEditor");
    setAccessibleName(tr("Lua gameplay source"));
    setAccessibleDescription(tr("Editable Lua, with native Unicode input, syntax highlighting, completion and line diagnostics."));
    setFont(QFontDatabase::systemFont(QFontDatabase::FixedFont));
    auto codeFont = font(); codeFont.setPointSize(13); setFont(codeFont);
    setLineWrapMode(QPlainTextEdit::NoWrap);
    setTabStopDistance(fontMetrics().horizontalAdvance(' ') * 4);
    setUndoRedoEnabled(false);
    highlighter_ = new LuaHighlighter(document());
    completer_->setWidget(this);
    completer_->setCaseSensitivity(Qt::CaseSensitive);
    completer_->setCompletionMode(QCompleter::PopupCompletion);
    completer_->setModel(new QStringListModel(completer_));
    setProjectNames({}, {});
    connect(completer_, QOverload<const QString &>::of(&QCompleter::activated), this, &CodeEditor::complete);
    connect(this, &QPlainTextEdit::blockCountChanged, this, [this] { setViewportMargins(numberAreaWidth(), 0, 0, 0); });
    connect(this, &QPlainTextEdit::updateRequest, this, [this](const QRect &rect, int dy) {
        if (dy) numbers_->scroll(0, dy);
        else numbers_->update(0, rect.y(), numbers_->width(), rect.height());
    });
    connect(this, &QPlainTextEdit::cursorPositionChanged, this, [this] {
        const auto cursor = textCursor();
        emit cursorStatus(tr("Line %1, column %2").arg(cursor.blockNumber() + 1).arg(cursor.positionInBlock() + 1));
    });
    diagnosticTimer_->setSingleShot(true);
    diagnosticTimer_->setInterval(500);
    connect(this, &QPlainTextEdit::textChanged, diagnosticTimer_, QOverload<>::of(&QTimer::start));
    connect(diagnosticTimer_, &QTimer::timeout, this, &CodeEditor::checkSyntax);
    setViewportMargins(numberAreaWidth(), 0, 0, 0);
}

void CodeEditor::setProjectNames(const QStringList &objects, const QStringList &assets)
{
    QStringList names;
    for (const auto &entry : reference()) names << entry.name;
    names << "nova.width" << "nova.height" << "input.horizontal" << "input.vertical" << "input.action";
    for (const auto &object : objects) names << "nova.object(\"" + object + "\")";
    for (const auto &asset : assets) names << "nova.asset(\"" + asset + "\")";
    names.sort();
    static_cast<QStringListModel *>(completer_->model())->setStringList(names);
}

void CodeEditor::setSource(const QByteArray &source)
{
    QString text = QString::fromUtf8(source);
    text.replace("\r\n", "\n");
    if (text == toPlainText()) return;
    const int position = textCursor().position();
    const int scroll = verticalScrollBar()->value();
    QSignalBlocker blocker(this);
    setPlainText(text);
    auto cursor = textCursor();
    cursor.setPosition(std::min(position, int(text.size())));
    setTextCursor(cursor);
    verticalScrollBar()->setValue(scroll);
    setViewportMargins(numberAreaWidth(), 0, 0, 0);
    diagnosticTimer_->start();
}

QString CodeEditor::completionPrefix() const
{
    auto cursor = textCursor();
    const auto text = cursor.block().text().left(cursor.positionInBlock());
    static const QRegularExpression suffix("[A-Za-z_][A-Za-z0-9_.]*$");
    return suffix.match(text).captured();
}

void CodeEditor::complete(const QString &completion)
{
    if (isReadOnly()) return;
    auto cursor = textCursor();
    const auto prefix = completionPrefix();
    cursor.movePosition(QTextCursor::Left, QTextCursor::KeepAnchor, prefix.size());
    cursor.insertText(completion);
    setTextCursor(cursor);
}

QKeySequence CodeEditor::completionShortcut()
{
#ifdef Q_OS_MACOS
    return QKeySequence(Qt::META | Qt::Key_Space);
#else
    return QKeySequence(Qt::CTRL | Qt::Key_Space);
#endif
}

void CodeEditor::showCompletion()
{
    if (isReadOnly()) { completer_->popup()->hide(); return; }
    completer_->setCompletionPrefix(completionPrefix());
    if (!completer_->completionCount()) { completer_->popup()->hide(); return; }
    auto rect = cursorRect();
    rect.setWidth(std::max(320, completer_->popup()->sizeHintForColumn(0) + 32));
    completer_->complete(rect);
}

void CodeEditor::keyPressEvent(QKeyEvent *event)
{
    if (isReadOnly()) {
        completer_->popup()->hide();
        QPlainTextEdit::keyPressEvent(event);
        return;
    }
    if (completer_->popup()->isVisible() &&
        (event->key() == Qt::Key_Enter || event->key() == Qt::Key_Return ||
         event->key() == Qt::Key_Escape || event->key() == Qt::Key_Tab)) { event->ignore(); return; }
    const bool requested = QKeySequence(event->keyCombination()) == completionShortcut();
    if (!requested) {
        if (event->key() == Qt::Key_Tab && !event->modifiers()) { insertPlainText("    "); return; }
        QPlainTextEdit::keyPressEvent(event);
    }
    const auto prefix = completionPrefix();
    if (requested || (!event->text().isEmpty() && prefix.contains('.'))) showCompletion();
    else completer_->popup()->hide();
    if (event->text() == "(") {
        const QString before = textCursor().block().text().left(textCursor().positionInBlock() - 1);
        for (const auto &entry : reference())
            if (before.endsWith(entry.name)) QToolTip::showText(mapToGlobal(cursorRect().bottomRight()),
                entry.signature + "\n" + entry.description, this);
    }
}

void CodeEditor::checkSyntax()
{
    const auto source = toPlainText().toUtf8();
    lua_State *lua = luaL_newstate();
    if (!lua) { emit syntaxResult(0, tr("Could not allocate the Lua syntax checker.")); return; }
    const int status = luaL_loadbufferx(lua, source.constData(), size_t(source.size()), sourceName_.constData(), "t");
    QString message;
    int line = 0;
    if (status != LUA_OK) {
        message = QString::fromUtf8(lua_tostring(lua, -1));
        line = QRegularExpression(":(\\d+):").match(message).captured(1).toInt();
    }
    lua_close(lua);
    QList<QTextEdit::ExtraSelection> marks;
    if (line > 0) {
        QTextEdit::ExtraSelection mark;
        mark.cursor = QTextCursor(document()->findBlockByNumber(line - 1));
        mark.format.setBackground(QColor(210, 50, 50, 45));
        mark.format.setProperty(QTextFormat::FullWidthSelection, true);
        marks << mark;
    }
    setExtraSelections(marks);
    emit syntaxResult(line, message);
}

void CodeEditor::goToLine(int line)
{
    const auto block = document()->findBlockByNumber(std::max(0, line - 1));
    if (block.isValid()) { setTextCursor(QTextCursor(block)); centerCursor(); }
    setFocus(Qt::ShortcutFocusReason);
}

void CodeEditor::findText()
{
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle(tr("Find in Lua"));
    auto *layout = new QHBoxLayout(dialog);
    auto *text = new QLineEdit(dialog);
    text->setAccessibleName(tr("Find text"));
    text->setPlaceholderText(tr("Find in the current Lua document"));
    auto *previous = new QPushButton(tr("Previous"), dialog);
    auto *next = new QPushButton(tr("Next"), dialog);
    layout->addWidget(text); layout->addWidget(previous); layout->addWidget(next);
    const auto search = [this, text](bool backwards) {
        if (text->text().isEmpty()) return;
        const auto flags = backwards ? QTextDocument::FindBackward : QTextDocument::FindFlags{};
        if (!find(text->text(), flags)) {
            auto cursor = textCursor();
            cursor.movePosition(backwards ? QTextCursor::End : QTextCursor::Start);
            setTextCursor(cursor);
            find(text->text(), flags);
        }
    };
    connect(next, &QPushButton::clicked, this, [search] { search(false); });
    connect(previous, &QPushButton::clicked, this, [search] { search(true); });
    connect(text, &QLineEdit::returnPressed, this, [search] { search(false); });
    dialog->show(); text->setFocus();
}

int CodeEditor::numberAreaWidth() const
{
    return 16 + fontMetrics().horizontalAdvance('9') * QString::number(std::max(1, blockCount())).size();
}

void CodeEditor::resizeEvent(QResizeEvent *event)
{
    QPlainTextEdit::resizeEvent(event);
    numbers_->setGeometry(QRect(contentsRect().topLeft(), QSize(numberAreaWidth(), contentsRect().height())));
}

void CodeEditor::changeEvent(QEvent *event)
{
    QPlainTextEdit::changeEvent(event);
    if (event->type() == QEvent::PaletteChange && highlighter_) highlighter_->rehighlight();
}

void CodeEditor::paintNumbers(QPaintEvent *event)
{
    QPainter painter(numbers_);
    painter.fillRect(event->rect(), palette().alternateBase());
    painter.setPen(palette().color(QPalette::Text));
    painter.setFont(font());
    QTextBlock block = firstVisibleBlock();
    int number = block.blockNumber();
    int top = qRound(blockBoundingGeometry(block).translated(contentOffset()).top());
    while (block.isValid() && top <= event->rect().bottom()) {
        const int height = qRound(blockBoundingRect(block).height());
        if (block.isVisible() && top + height >= event->rect().top())
            painter.drawText(0, top, numbers_->width() - 8, fontMetrics().height(), Qt::AlignRight,
                QString::number(number + 1));
        top += height; block = block.next(); ++number;
    }
}
