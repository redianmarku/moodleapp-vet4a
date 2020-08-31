/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
*/

/* global cordova */

var exec = require('cordova/exec');

var WKUserScript = {

    addScript: function (data) {
        return new Promise(function(resolve, reject) {
            if (typeof data.code == 'string') {
                exec(resolve, reject, 'WKUserScript', 'addScriptCode', [data.id, data.code, data.injectionTime || 0]);
            } else if (typeof data.file == 'string') {
                var path = data.file.replace(/^file:\/\//, ''); // Remove "file://" from the path, the plugin doesn't need it.

                exec(resolve, reject, 'WKUserScript', 'addScriptFile', [data.id, path, data.injectionTime || 0]);
            } else {
                reject('addScript requires exactly one of code or file to be specified');
            }
        });
    },

};

module.exports = WKUserScript;
