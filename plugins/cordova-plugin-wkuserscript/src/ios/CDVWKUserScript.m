/*
 Licensed to the Apache Software Foundation (ASF) under one
 or more contributor license agreements.  See the NOTICE file
 distributed with this work for additional information
 regarding copyright ownership.  The ASF licenses this file
 to you under the Apache License, Version 2.0 (the
 "License"); you may not use this file except in compliance
 with the License.  You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
 */

/*
 NOTE: plugman/cordova cli should have already installed this,
 but you need the value UIViewControllerBasedStatusBarAppearance
 in your Info.plist as well to set the styles in iOS 7
 */

#import "CDVWKUserScript.h"
#import <WebKit/WebKit.h>

@interface CDVWKUserScript () {}
@end

@implementation CDVWKUserScript

- (void) addScriptFile:(CDVInvokedUrlCommand*)command
{
    NSString *scriptId = [command.arguments objectAtIndex:0];
    NSString *path = [command.arguments objectAtIndex:1];
    int injectionTime = [[command.arguments objectAtIndex:2] intValue];

    if ([self scriptNotLoaded:scriptId]) {
        NSError *error = nil;
        NSString *source = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:&error];

        if (source == nil || error != nil) {
            NSLog(@"CDVWKUserScript: Error reading script file: %@", error);
        } else {
            [self addScript:source injectionTime:[self parseInjectionTime:injectionTime]];
        }
    }

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
}

- (void) addScriptCode:(CDVInvokedUrlCommand*)command
{
    NSString *scriptId = [command.arguments objectAtIndex:0];
    int injectionTime = [[command.arguments objectAtIndex:2] intValue];

    if ([self scriptNotLoaded:scriptId]) {
        [self addScript:[command.arguments objectAtIndex:1] injectionTime:[self parseInjectionTime:injectionTime]];
    }

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
}

- (bool) scriptNotLoaded:(NSString*)scriptId
{
    if (self.idsLoaded == nil) {
        self.idsLoaded = [[NSMutableDictionary alloc] init];
    }

    if (self.idsLoaded[scriptId]) {
        NSLog(@"CDVWKUserScript: Script already loaded, ignore: %@", scriptId);

        return false;
    } else {
        self.idsLoaded[scriptId] = scriptId;

        return true;
    }
}

- (WKUserScriptInjectionTime) parseInjectionTime:(int)injectionTime
{
    if (injectionTime == 1) {
        return WKUserScriptInjectionTimeAtDocumentEnd;
    } else {
        return WKUserScriptInjectionTimeAtDocumentStart;
    }
}

- (void) addScript:(NSString*)source injectionTime:(WKUserScriptInjectionTime)injectionTime
{
    WKWebView* wkWebView = (WKWebView*)self.webView;

    WKUserScript *script = [[WKUserScript alloc] initWithSource:source
                                injectionTime:injectionTime
                                forMainFrameOnly:NO];

    WKUserContentController* userContentController = wkWebView.configuration.userContentController;
    [userContentController addUserScript:script];
}

@end
