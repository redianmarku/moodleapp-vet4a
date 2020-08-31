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

import { Component, Optional, Injector, Input } from '@angular/core';
import { Content, ModalController } from 'ionic-angular';
import {
    CoreCourseModuleMainResourceComponent, CoreCourseResourceDownloadResult
} from '@core/course/classes/main-resource-component';
import {
    AddonModBookProvider, AddonModBookContentsMap, AddonModBookTocChapter, AddonModBookBook, AddonModBookNavStyle
} from '../../providers/book';
import { CoreTagProvider } from '@core/tag/providers/tag';

/**
 * Component that displays a book.
 */
@Component({
    selector: 'addon-mod-book-index',
    templateUrl: 'addon-mod-book-index.html',
})
export class AddonModBookIndexComponent extends CoreCourseModuleMainResourceComponent {
    @Input() initialChapterId: string; // The initial chapter ID to load.

    component = AddonModBookProvider.COMPONENT;
    chapterContent: string;
    previousChapter: AddonModBookTocChapter;
    nextChapter: AddonModBookTocChapter;
    tagsEnabled: boolean;
    displayNavBar = true;
    previousNavBarTitle: string;
    nextNavBarTitle: string;
    warning: string;

    protected chapters: AddonModBookTocChapter[];
    protected currentChapter: string;
    protected contentsMap: AddonModBookContentsMap;
    protected book: AddonModBookBook;
    protected displayTitlesInNavBar = false;

    constructor(injector: Injector,
            protected bookProvider: AddonModBookProvider,
            protected modalCtrl: ModalController,
            protected tagProvider: CoreTagProvider,
            @Optional() protected content: Content) {
        super(injector);
    }

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        super.ngOnInit();

        this.tagsEnabled = this.tagProvider.areTagsAvailableInSite();

        this.loadContent();
    }

    /**
     * Show the TOC.
     *
     * @param event Event.
     */
    showToc(event: MouseEvent): void {
        // Create the toc modal.
        const modal =  this.modalCtrl.create('AddonModBookTocPage', {
            moduleId: this.module.id,
            chapters: this.chapters,
            selected: this.currentChapter,
            courseId: this.courseId,
            book: this.book,
        }, { cssClass: 'core-modal-lateral',
            showBackdrop: true,
            enableBackdropDismiss: true,
            enterAnimation: 'core-modal-lateral-transition',
            leaveAnimation: 'core-modal-lateral-transition' });

        modal.onDidDismiss((chapterId) => {
            if (chapterId) {
                this.changeChapter(chapterId);
            }
        });

        modal.present({
            ev: event
        });
    }

    /**
     * Change the current chapter.
     *
     * @param chapterId Chapter to load.
     * @return Promise resolved when done.
     */
    changeChapter(chapterId: string): void {
        if (chapterId && chapterId != this.currentChapter) {
            this.loaded = false;
            this.refreshIcon = 'spinner';
            this.loadChapter(chapterId, true);
        }
    }

    /**
     * Perform the invalidate content function.
     *
     * @return Resolved when done.
     */
    protected invalidateContent(): Promise<any> {
        return this.bookProvider.invalidateContent(this.module.id, this.courseId);
    }

    /**
     * Download book contents and load the current chapter.
     *
     * @param refresh Whether we're refreshing data.
     * @return Promise resolved when done.
     */
    protected fetchContent(refresh?: boolean): Promise<any> {
        const promises = [];
        let downloadResult: CoreCourseResourceDownloadResult;

        // Try to get the book data.
        promises.push(this.bookProvider.getBook(this.courseId, this.module.id).then((book) => {
            this.book = book;
            this.dataRetrieved.emit(book);
            this.description = book.intro;
            this.displayNavBar = book.navstyle != AddonModBookNavStyle.TOC_ONLY;
            this.displayTitlesInNavBar = book.navstyle == AddonModBookNavStyle.TEXT;
        }).catch(() => {
            // Ignore errors since this WS isn't available in some Moodle versions.
        }));

        // Get module status to determine if it needs to be downloaded.
        promises.push(this.downloadResourceIfNeeded(refresh).then((result) => {
            downloadResult = result;
        }));

        return Promise.all(promises).then(() => {
            this.contentsMap = this.bookProvider.getContentsMap(this.module.contents);
            this.chapters = this.bookProvider.getTocList(this.module.contents);

            if (typeof this.currentChapter == 'undefined' && typeof this.initialChapterId != 'undefined' && this.chapters) {
                // Initial chapter set. Validate that the chapter exists.
                const chapter = this.chapters.find((chapter) => {
                    return chapter.id == this.initialChapterId;
                });

                if (chapter) {
                    this.currentChapter = this.initialChapterId;
                }
            }

            if (typeof this.currentChapter == 'undefined') {
                // Load the first chapter.
                this.currentChapter = this.bookProvider.getFirstChapter(this.chapters);
            }

            // Show chapter.
            return this.loadChapter(this.currentChapter, refresh).then(() => {
                this.warning = downloadResult.failed ? this.getErrorDownloadingSomeFilesMessage(downloadResult.error) : '';
            }).catch(() => {
                // Ignore errors, they're handled inside the loadChapter function.
            });
        }).finally(() => {
            this.fillContextMenu(refresh);
        });
    }

    /**
     * Load a book chapter.
     *
     * @param chapterId Chapter to load.
     * @param logChapterId Whether chapter ID should be passed to the log view function.
     * @return Promise resolved when done.
     */
    protected loadChapter(chapterId: string, logChapterId: boolean): Promise<void> {
        this.currentChapter = chapterId;
        this.domUtils.scrollToTop(this.content);

        return this.bookProvider.getChapterContent(this.contentsMap, chapterId, this.module.id).then((content) => {
            this.chapterContent = content;
            this.previousChapter = this.bookProvider.getPreviousChapter(this.chapters, chapterId);
            this.nextChapter = this.bookProvider.getNextChapter(this.chapters, chapterId);

            this.previousNavBarTitle = this.previousChapter && this.displayTitlesInNavBar ?
                    this.translate.instant('addon.mod_book.navprevtitle', {$a: this.previousChapter.title}) : '';
            this.nextNavBarTitle = this.nextChapter && this.displayTitlesInNavBar ?
                    this.translate.instant('addon.mod_book.navnexttitle', {$a: this.nextChapter.title}) : '';

            // Chapter loaded, log view. We don't return the promise because we don't want to block the user for this.
            this.bookProvider.logView(this.module.instance, logChapterId ? chapterId : undefined, this.module.name).then(() => {
                // Module is completed when last chapter is viewed, so we only check completion if the last is reached.
                if (!this.nextChapter) {
                    this.courseProvider.checkModuleCompletion(this.courseId, this.module.completiondata);
                }
            }).catch(() => {
                // Ignore errors.
            });
        }).catch((error) => {
            this.domUtils.showErrorModalDefault(error, 'addon.mod_book.errorchapter', true);

            return Promise.reject(null);
        }).finally(() => {
            this.loaded = true;
            this.refreshIcon = 'refresh';
        });
    }
}
