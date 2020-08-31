---
title: WKUserScript
description: Plugin to add WKUserScripts in WKWebView (iOS).
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

# cordova-plugin-wkuserscript

Plugin to add WKUserScripts in WKWebView (iOS). This can be used to inject JS code to all iframes of your app, for example to intercept window.open calls.

Please notice that this plugin requires you to use WKWebView.


## Installation

This plugin isn't published in npm yet, so it must be installed via repo url:

    cordova plugin add  https://github.com/moodlemobile/cordova-plugin-wkuserscript


## Methods

This plugin defines global `WKUserScript` object.

Although in the global scope, it is not available until after the `deviceready` event.

    document.addEventListener("deviceready", onDeviceReady, false);
    function onDeviceReady() {
        console.log(WKUserScript);
    }

- WKUserScript.addScript

## WKUserScript.addScript

Adds a user script that will be injected to all iframes of the app (and also to the WebView, be careful with that). You can either pass the JS code to inject or the path of a JS script to inject.


### Supported Platforms

- iOS 11+

### Quick Example

    WKUserScript.addScript({
        code: 'window.myGlobalVar = "Test";',
    }).then(function() {
        // Success.
    }).catch(function() {
        // Error.
    });
