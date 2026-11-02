#include "studio_window.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QFileInfo>
#include <QSurfaceFormat>
#include <clocale>

extern "C" {
#include "assets.h"
}

int main(int argc, char **argv)
{
    QSurfaceFormat format;
    format.setRenderableType(QSurfaceFormat::OpenGL);
    format.setVersion(3, 3);
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setDepthBufferSize(24);
    QSurfaceFormat::setDefaultFormat(format);
    QApplication app(argc, argv);
    std::setlocale(LC_NUMERIC, "C");
    QApplication::setOrganizationName("NovaStudio");
    QApplication::setApplicationName("Nova Studio");
    QApplication::setApplicationVersion("0.2.0-foundation");
    QCommandLineParser parser;
    parser.setApplicationDescription("Native Qt Scene and Lua authoring. The nova_studio CLI remains the game runtime.");
    parser.addHelpOption(); parser.addVersionOption();
    parser.addOption({{"p", "project"}, "Open a .project manifest without converting legacy source.", "path"});
    parser.process(app);
    QString examples = QDir(QApplication::applicationDirPath()).filePath("examples");
#ifdef Q_OS_MACOS
    examples = QDir(QApplication::applicationDirPath()).filePath("../Resources/examples");
#endif
    int result;
    {
        StudioWindow window(examples);
        window.show();
        if (parser.isSet("project")) window.openProject(parser.value("project"));
        result = app.exec();
    }
    nova_shutdown_audio();
    return result;
}
