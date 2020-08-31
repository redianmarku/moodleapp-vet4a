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

import { Component } from '@angular/core';
import { IonicPage, NavParams } from 'ionic-angular';

/**
 * Page that displays a list of notes.
 */
@IonicPage({ segment: 'addon-notes-list-page' })
@Component({
    selector: 'page-addon-notes-list-page',
    templateUrl: 'list.html',
})
export class AddonNotesListPage {
    userId: number;
    courseId: number;

    constructor(params: NavParams) {
        this.userId = params.get('userId');
        this.courseId = params.get('courseId');
    }
}
