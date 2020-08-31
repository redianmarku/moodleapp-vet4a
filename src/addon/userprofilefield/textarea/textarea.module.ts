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
import { TranslateModule } from '@ngx-translate/core';
import { AddonUserProfileFieldTextareaHandler } from './providers/handler';
import { CoreUserProfileFieldDelegate } from '@core/user/providers/user-profile-field-delegate';
import { AddonUserProfileFieldTextareaComponent } from './component/textarea';
import { CoreComponentsModule } from '@components/components.module';
import { CoreDirectivesModule } from '@directives/directives.module';
import { CoreEditorComponentsModule } from '@core/editor/components/components.module';

@NgModule({
    declarations: [
        AddonUserProfileFieldTextareaComponent
    ],
    imports: [
        IonicModule,
        TranslateModule.forChild(),
        CoreComponentsModule,
        CoreDirectivesModule,
        CoreEditorComponentsModule,
    ],
    providers: [
        AddonUserProfileFieldTextareaHandler
    ],
    exports: [
        AddonUserProfileFieldTextareaComponent
    ],
    entryComponents: [
        AddonUserProfileFieldTextareaComponent
    ]
})
export class AddonUserProfileFieldTextareaModule {
    constructor(userProfileFieldDelegate: CoreUserProfileFieldDelegate, handler: AddonUserProfileFieldTextareaHandler) {
        userProfileFieldDelegate.registerHandler(handler);
    }
}
