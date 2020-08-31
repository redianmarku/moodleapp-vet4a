// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { NgModule } from '@angular/core';
import { IonicModule } from 'ionic-angular';
import { CoreFilterDelegate } from '@core/filter/providers/delegate';
import { AddonFilterActivityNamesHandler } from './providers/handler';

@NgModule({
    declarations: [
    ],
    imports: [
        IonicModule
    ],
    providers: [
        AddonFilterActivityNamesHandler
    ]
})
export class AddonFilterActivityNamesModule {
    constructor(filterDelegate: CoreFilterDelegate, handler: AddonFilterActivityNamesHandler) {
        filterDelegate.registerHandler(handler);
    }
}
