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
import { CommonModule } from '@angular/common';
import { IonicModule } from 'ionic-angular';
import { TranslateModule } from '@ngx-translate/core';
import { AddonModAssignSubmissionOnlineTextHandler } from './providers/handler';
import { AddonModAssignSubmissionOnlineTextComponent } from './component/onlinetext';
import { AddonModAssignSubmissionDelegate } from '../../providers/submission-delegate';
import { CoreComponentsModule } from '@components/components.module';
import { CoreDirectivesModule } from '@directives/directives.module';
import { CoreEditorComponentsModule } from '@core/editor/components/components.module';

@NgModule({
    declarations: [
        AddonModAssignSubmissionOnlineTextComponent
    ],
    imports: [
        CommonModule,
        IonicModule,
        TranslateModule.forChild(),
        CoreComponentsModule,
        CoreDirectivesModule,
        CoreEditorComponentsModule,
    ],
    providers: [
        AddonModAssignSubmissionOnlineTextHandler
    ],
    exports: [
        AddonModAssignSubmissionOnlineTextComponent
    ],
    entryComponents: [
        AddonModAssignSubmissionOnlineTextComponent
    ]
})
export class AddonModAssignSubmissionOnlineTextModule {
    constructor(submissionDelegate: AddonModAssignSubmissionDelegate, handler: AddonModAssignSubmissionOnlineTextHandler) {
        submissionDelegate.registerHandler(handler);
    }
}
