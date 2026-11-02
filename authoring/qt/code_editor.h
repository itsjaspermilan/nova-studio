#ifndef NOVA_QT_CODE_EDITOR_H
#define NOVA_QT_CODE_EDITOR_H

#include <QPlainTextEdit>
#include <QKeySequence>
#include <QStringList>
#include <QVector>

class QCompleter;
class QTimer;
class LineNumbers;
class QSyntaxHighlighter;

struct LuaReference {
    QString name, signature, description;
};

class CodeEditor final : public QPlainTextEdit {
    Q_OBJECT
public:
    explicit CodeEditor(QWidget *parent = nullptr);
    static const QVector<LuaReference> &reference();
    static QKeySequence completionShortcut();
    void setProjectNames(const QStringList &objects, const QStringList &assets);
    void setSource(const QByteArray &source);
    void setSourceName(const QString &name) { sourceName_ = "@" + name.toUtf8(); }
    void goToLine(int line);
    void checkSyntax();
    void findText();
    void showCompletion();
    int numberAreaWidth() const;
    void paintNumbers(QPaintEvent *event);
    QCompleter *completer() const { return completer_; }

signals:
    void syntaxResult(int line, const QString &message);
    void cursorStatus(const QString &message);

protected:
    void keyPressEvent(QKeyEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;
    void changeEvent(QEvent *event) override;

private:
    QString completionPrefix() const;
    void complete(const QString &completion);
    QCompleter *completer_;
    QTimer *diagnosticTimer_;
    LineNumbers *numbers_;
    QSyntaxHighlighter *highlighter_ = nullptr;
    QByteArray sourceName_ = "@main.lua";
};
#endif
