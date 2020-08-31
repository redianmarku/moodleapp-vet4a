---
title: WKWebView Cookies
description: Plugin to manage cookies in WKWebView (iOS).
---
<!---
# license: Licensed to the Apache Software Foundation (ASF) under one
#         or more contributor license agreements.  See the NOTICE file
#         distributed with this work for additional information
#         regarding copyright ownership.  The ASF licenses this file
#         to you under the Apache License, Version 2.0 (the
#         "License"); you may not use this file except in compliance
#         with the License.  You may obtain a copy of the License at
#
#           http://www.apache.org/licenses/LICENSE-2.0
#
#         Unless required by applicable law or agreed to in writing,
#         software distributed under the License is distributed on an
#         "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
#         KIND, either express or implied.  See the License for the
#         specific language governing permissions and limitations
#         under the License.
-->

# cordova-plugin-wkwebview-cookies

Plugin to manage cookies in WKWebView. This is needed in order to fix cookies not stored in iframes in WKWebView.

Please notice that this plugin requires you to use WKWebView.


## Installation

This plugin isn't published in npm because it's private, so it must be installed via repo url:

    cordova plugin add  https://github.com/moodlemobile/cordova-plugin-wkwebview-cookies


## Methods

This plugin defines global `WKWebViewCookies` object.

Although in the global scope, it is not available until after the `deviceready` event.

    document.addEventListener("deviceready", onDeviceReady, false);
    function onDeviceReady() {
        console.log(WKWebViewCookies);
    }

- WKWebViewCookies.setCookie

## WKWebViewCookies.setCookie

Stores a cookie in the WebView. If you only want to store a cookie to make cookies in iframe work then you can store any name/value, just make sure that the domain belongs to the iframe domain.


### Supported Platforms

- iOS 11+

### Quick Example

    WKWebViewCookies.setCookie({
        name: 'CookieName',
        value: 'CookieValue',
        domain: 'example.edu'
    }).then(function() {
        // Success.
    }).catch(function() {
        // Error.
    });
