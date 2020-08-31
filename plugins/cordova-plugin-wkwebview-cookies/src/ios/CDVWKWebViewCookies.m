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

#import "CDVWKWebViewCookies.h"
#import <WebKit/WebKit.h>

@interface CDVWKWebViewCookies () {}
@end

@implementation CDVWKWebViewCookies

- (void) setCookie:(CDVInvokedUrlCommand*)command
{
    NSDictionary *data = [command.arguments objectAtIndex:0];

    WKWebView* wkWebView = (WKWebView*)self.webView;
    NSDictionary *properties = @{
        NSHTTPCookiePath: data[@"path"],
        NSHTTPCookieName: data[@"name"],
        NSHTTPCookieValue: data[@"value"],
        NSHTTPCookieDomain: data[@"domain"],
    };
    NSHTTPCookie* cookie = [NSHTTPCookie cookieWithProperties:properties];
    [wkWebView.configuration.websiteDataStore.httpCookieStore setCookie:cookie completionHandler:nil];

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
}

@end
