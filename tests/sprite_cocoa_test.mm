#include <QWidget>
#import <Cocoa/Cocoa.h>

bool novaSpriteDesktopIsLocked()
{
    CFDictionaryRef session = CGSessionCopyCurrentDictionary();
    if (!session) return false;
    CFTypeRef value = CFDictionaryGetValue(session, CFSTR("CGSSessionScreenIsLocked"));
    bool locked = value && CFGetTypeID(value) == CFBooleanGetTypeID() &&
                  CFBooleanGetValue(static_cast<CFBooleanRef>(value));
    CFRelease(session);
    return locked;
}

bool novaSpriteTestWindowIsKey(QWidget *widget)
{
    NSView *view = reinterpret_cast<NSView *>(widget->winId());
    return [NSApp isActive] && [view.window isKeyWindow];
}
