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
import { Content, NavController, PopoverController, ViewController, ModalController } from 'ionic-angular';
import { CoreGroupsProvider } from '@providers/groups';
import { CoreUtilsProvider } from '@providers/utils/utils';
import { CoreCourseModuleMainActivityComponent } from '@core/course/classes/main-activity-component';
import { CoreUserProvider } from '@core/user/providers/user';
import { AddonModWikiProvider, AddonModWikiSubwikiListData } from '../../providers/wiki';
import { AddonModWikiOfflineProvider } from '../../providers/wiki-offline';
import { AddonModWikiSyncProvider } from '../../providers/wiki-sync';
import { AddonModWikiSubwikiPickerComponent } from '../../components/subwiki-picker/subwiki-picker';
import { CoreTagProvider } from '@core/tag/providers/tag';

/**
 * Component that displays a wiki entry page.
 */
@Component({
    selector: 'addon-mod-wiki-index',
    templateUrl: 'addon-mod-wiki-index.html',
})
export class AddonModWikiIndexComponent extends CoreCourseModuleMainActivityComponent {

    @Input() action: string;
    @Input() pageId: number;
    @Input() pageTitle: string;
    @Input() wikiId: number;
    @Input() subwikiId: number;
    @Input() userId: number;
    @Input() groupId: number;

    component = AddonModWikiProvider.COMPONENT;
    componentId: number;
    moduleName = 'wiki';
    groupWiki = false;

    wiki: any; // The wiki instance.
    isMainPage: boolean; // Whether the user is viewing wiki's main page (just entered the wiki).
    canEdit = false; // Whether user can edit the page.
    pageStr = '';
    pageWarning: string; // Message telling that the page was discarded.
    loadedSubwikis: any[] = []; // The loaded subwikis.
    pageIsOffline: boolean; // Whether the loaded page is an offline page.
    pageContent: string; // Page content to display.
    subwikiData: AddonModWikiSubwikiListData = { // Data for the subwiki selector.
        subwikiSelected: 0,
        userSelected: 0,
        groupSelected: 0,
        subwikis: [],
        count: 0
    };
    tagsEnabled: boolean;
    currentPageObj: any; // Object of the current loaded page.

    protected syncEventName = AddonModWikiSyncProvider.AUTO_SYNCED;
    protected currentSubwiki: any; // Current selected subwiki.
    protected currentPage: number; // Current loaded page ID.
    protected subwikiPages: any[]; // List of subwiki pages.
    protected newPageObserver: any; // Observer to check for new pages.
    protected ignoreManualSyncEvent: boolean; // Whether manual sync event should be ignored.
    protected manualSyncObserver: any; // An observer to watch for manual sync events.
    protected currentUserId: number; // Current user ID.
    protected hasEdited = false; // Whether the user has opened the edit page.

    constructor(injector: Injector, protected wikiProvider: AddonModWikiProvider, @Optional() protected content: Content,
            protected wikiOffline: AddonModWikiOfflineProvider, protected wikiSync: AddonModWikiSyncProvider,
            protected navCtrl: NavController, protected utils: CoreUtilsProvider, protected groupsProvider: CoreGroupsProvider,
            protected userProvider: CoreUserProvider, private popoverCtrl: PopoverController,
            private tagProvider: CoreTagProvider, protected modalCtrl: ModalController) {
        super(injector, content);

        this.pageStr = this.translate.instant('addon.mod_wiki.wikipage');
        this.tagsEnabled = this.tagProvider.areTagsAvailableInSite();
    }

    /**
     * Component being initialized.
     */
    ngOnInit(): void {
        super.ngOnInit();

        this.currentUserId = this.sitesProvider.getCurrentSiteUserId();
        this.isMainPage = !this.pageId && !this.pageTitle;
        this.currentPage = this.pageId;

        this.loadContent(false, true).then(() => {
            if (!this.wiki) {
                return;
            }

            if (!this.pageId) {
                this.wikiProvider.logView(this.wiki.id, this.wiki.name).then(() => {
                    this.courseProvider.checkModuleCompletion(this.courseId, this.module.completiondata);
                }).catch((error) => {
                    // Ignore errors.
                });
            } else {
                this.wikiProvider.logPageView(this.pageId, this.wiki.id, this.wiki.name).catch((error) => {
                    // Ignore errors.
                });
            }
        }).finally(() => {
            if (this.action == 'map') {
                this.openMap();
            }
        });

        // Listen for manual sync events.
        this.manualSyncObserver = this.eventsProvider.on(AddonModWikiSyncProvider.MANUAL_SYNCED, (data) => {
            if (data && this.wiki && data.wikiId == this.wiki.id) {
                if (this.ignoreManualSyncEvent) {
                    // Event needs to be ignored.
                    this.ignoreManualSyncEvent = false;

                    return;
                }

                if (this.currentSubwiki) {
                    this.checkPageCreatedOrDiscarded(data.subwikis[this.currentSubwiki.id]);
                }

                if (!this.pageWarning) {
                    this.showLoadingAndFetch(false, false);
                }
            }
        }, this.siteId);
    }

    /**
     * Check if the current page was created or discarded.
     *
     * @param data Data about created and deleted pages.
     */
    protected checkPageCreatedOrDiscarded(data: any): void {
        if (!this.currentPage && data) {
            // This is an offline page. Check if the page was created.
            const page = data.created.find((page) => page.title == this.pageTitle);
            if (page) {
                // Page was created, set the ID so it's retrieved from server.
                this.currentPage = page.pageId;
                this.pageIsOffline = false;
            } else {
                // Page not found in created list, check if it was discarded.
                const page = data.discarded.find((page) => page.title == this.pageTitle);
                if (page) {
                    // Page discarded, show warning.
                    this.pageWarning = page.warning;
                    this.pageContent = '';
                    this.pageIsOffline = false;
                    this.hasOffline = false;
                }
            }
        }
    }

    /**
     * Get the wiki data.
     *
     * @param refresh If it's refreshing content.
     * @param sync If it should try to sync.
     * @param showErrors If show errors to the user of hide them.
     * @return Promise resolved when done.
     */
    protected fetchContent(refresh: boolean = false, sync: boolean = false, showErrors: boolean = false): Promise<any> {

        // Get the wiki instance.
        let promise;
        if (this.module.id) {
            promise = this.wikiProvider.getWiki(this.courseId, this.module.id);
        } else {
            promise = this.wikiProvider.getWikiById(this.courseId, this.wikiId);
        }

        return promise.then((wiki) => {
            this.wiki = wiki;

            this.dataRetrieved.emit(this.wiki);

            if (sync) {
                // Try to synchronize the wiki.
                return this.syncActivity(showErrors).catch(() => {
                    // Ignore errors.
                });
            }
        }).then(() => {
            if (this.pageWarning) {
                // Page discarded, stop getting data.
                return Promise.reject(null);
            }

            // Get module instance if it's empty.
            let promise;
            if (!this.module.id) {
                promise = this.courseProvider.getModule(this.wiki.coursemodule, this.wiki.course, undefined, true);
            } else {
                promise = Promise.resolve(this.module);
            }

            return promise.then((mod) => {
                this.module = mod;

                this.description = this.wiki.intro || this.module.description;
                this.externalUrl = this.module.url;
                this.componentId = this.module.id;

                // Get real groupmode, in case it's forced by the course.
                return this.groupsProvider.getActivityGroupInfo(this.wiki.coursemodule).then((groupInfo) => {
                    return this.fetchSubwikis(this.wiki.id).then(() => {
                        // Get the subwiki list data from the cache.
                        const subwikiList = this.wikiProvider.getSubwikiList(this.wiki.id);

                        if (!subwikiList) {
                            // Not found in cache, create a new one.
                            return this.createSubwikiList(groupInfo.groups);
                        }

                        this.subwikiData.count = subwikiList.count;
                        this.setSelectedWiki(this.subwikiId, this.userId, this.groupId);

                        // If nothing was selected using nav params, use the selected from cache.
                        if (!this.isAnySubwikiSelected()) {
                            this.setSelectedWiki(subwikiList.subwikiSelected, subwikiList.userSelected,
                                    subwikiList.groupSelected);
                        }

                        this.subwikiData.subwikis = subwikiList.subwikis;
                    });
                }).then(() => {

                    if (!this.isAnySubwikiSelected() || this.subwikiData.count <= 0) {
                        return Promise.reject(this.translate.instant('addon.mod_wiki.errornowikiavailable'));
                    }
                }).then(() => {
                    return this.fetchWikiPage();
                });
            });
        }).finally(() => {
            this.fillContextMenu(refresh);
        }).catch((error) => {
            if (this.pageWarning) {
                // Warning is already shown in screen, no need to show a modal.
                return;
            }

            return Promise.reject(error);
        });
    }

    /**
     * Get wiki page contents.
     *
     * @param pageId Page to get.
     * @return Promise resolved with the page data.
     */
    protected fetchPageContents(pageId: number): Promise<any> {
        if (!pageId) {
            const title = this.pageTitle || this.wiki.firstpagetitle;

            // No page ID but we received a title. This means we're trying to load an offline page.
            return this.wikiOffline.getNewPage(title, this.currentSubwiki.id, this.currentSubwiki.wikiid,
                    this.currentSubwiki.userid, this.currentSubwiki.groupid).then((offlinePage) => {

                this.pageIsOffline = true;
                if (!this.newPageObserver) {
                    // It's an offline page, listen for new pages event to detect if the user goes to Edit and submits the page.
                    this.newPageObserver = this.eventsProvider.on(AddonModWikiProvider.PAGE_CREATED_EVENT, (data) => {
                        if (data.subwikiId == this.currentSubwiki.id && data.pageTitle == title) {
                            // The page has been submitted. Get the page from the server.
                            this.currentPage = data.pageId;

                            this.showLoadingAndFetch(true, false).then(() => {
                                if (this.currentPage) {
                                    this.wikiProvider.logPageView(this.currentPage, this.wiki.id, this.wiki.name).catch(() => {
                                        // Ignore errors.
                                    });
                                }
                            });

                            // Stop listening for new page events.
                            this.newPageObserver.off();
                            this.newPageObserver = undefined;
                        }
                    }, this.sitesProvider.getCurrentSiteId());
                }

                return offlinePage;
            }).catch(() => {
                // Page not found, ignore.
            });
        }

        this.pageIsOffline = false;

        return this.wikiProvider.getPageContents(pageId);
    }

    /**
     * Fetch the list of pages of a subwiki.
     *
     * @param subwiki Subwiki.
     */
    protected fetchSubwikiPages(subwiki: any): Promise<any> {
        let subwikiPages;

        return this.wikiProvider.getSubwikiPages(subwiki.wikiid, subwiki.groupid, subwiki.userid).then((pages) => {
            subwikiPages = pages;

            // If no page specified, search first page.
            if (!this.currentPage && !this.pageTitle) {
                const firstPage = subwikiPages.find((page) => page.firstpage );
                if (firstPage) {
                    this.currentPage = firstPage.id;
                }
            }

            // Now get the offline pages.
            return this.wikiOffline.getSubwikiNewPages(subwiki.id, subwiki.wikiid, subwiki.userid, subwiki.groupid);
        }).then((offlinePages) => {

            // If no page specified, search page title in the offline pages.
            if (!this.currentPage) {
                const searchTitle = this.pageTitle ? this.pageTitle : this.wiki.firstpagetitle,
                    pageExists = offlinePages.some((page) => {
                        return page.title == searchTitle;
                    });

                if (pageExists) {
                    this.pageTitle = searchTitle;
                }
            }

            this.subwikiPages = this.wikiProvider.sortPagesByTitle(subwikiPages.concat(offlinePages));

            // Reject if no currentPage selected from the subwikis given (if no subwikis available, do not reject).
            if (!this.currentPage && !this.pageTitle && this.subwikiPages.length > 0) {
                return Promise.reject(null);
            }
        });
    }

    /**
     * Get the subwikis.
     *
     * @param wikiId Wiki ID.
     */
    protected fetchSubwikis(wikiId: number): Promise<any> {
        return this.wikiProvider.getSubwikis(wikiId).then((subwikis) => {
            this.loadedSubwikis = subwikis;

            return this.wikiOffline.subwikisHaveOfflineData(subwikis).then((hasOffline) => {
                this.hasOffline = hasOffline;
            });
        });
    }

    /**
     * Fetch the page to be shown.
     *
     * @return [description]
     */
    protected fetchWikiPage(): Promise<any> {
        // Search the current Subwiki.
        this.currentSubwiki = this.loadedSubwikis.find((subwiki) => {
            return this.isSubwikiSelected(subwiki);
        });

        if (!this.currentSubwiki) {
            return Promise.reject(null);
        }

        this.setSelectedWiki(this.currentSubwiki.id, this.currentSubwiki.userid, this.currentSubwiki.groupid);

        return this.fetchSubwikiPages(this.currentSubwiki).then(() => {
            // Check can edit before to have the value if there's no valid page.
            this.canEdit = this.currentSubwiki.canedit;

            return this.fetchPageContents(this.currentPage).then((pageContents) => {
                if (pageContents) {
                    this.dataRetrieved.emit(pageContents.title);
                    this.setSelectedWiki(pageContents.subwikiid, pageContents.userid, pageContents.groupid);

                    this.pageContent = this.replaceEditLinks(pageContents.cachedcontent);
                    this.canEdit = pageContents.caneditpage;
                    this.currentPageObj = pageContents;
                }
            });
        });
    }

    /**
     * Get the wiki home view. If cannot determine or it's current view, return undefined.
     *
     * @return The view controller of the home view
     */
    protected getWikiHomeView(): ViewController {

        if (!this.wiki.id) {
            return;
        }

        const views = this.navCtrl.getViews();

        // Go back in history until we find a page that doesn't belong to current wiki.
        for (let i = views.length - 2; i >= 0; i--) {
            const view = views[i];

            if (view.component.name != 'AddonModWikiIndexPage') {
                if (i == views.length - 2) {
                    // Next view is current view, return undefined.
                    return;
                }

                // This view is no longer from wiki, return the next view.
                return views[i + 1];
            }

            // Check that the view belongs to the same wiki as current view.
            const wikiId = view.data.wikiId ? view.data.wikiId : view.data.module.instance;

            if (!wikiId || wikiId != this.wiki.id) {
                // Wiki has changed, return the next view.
                return views[i + 1];
            }
        }
    }

    /**
     * Open the view to create the first page of the wiki.
     */
    protected goToCreateFirstPage(): void {
        this.navCtrl.push('AddonModWikiEditPage', {
            module: this.module,
            courseId: this.courseId,
            pageTitle: this.wiki.firstpagetitle,
            wikiId: this.currentSubwiki.wikiid,
            userId: this.currentSubwiki.userid,
            groupId: this.currentSubwiki.groupid
        });
    }

    /**
     * Open the view to edit the current page.
     */
    goToEditPage(): void {
        if (!this.canEdit) {
            return;
        }

        if (this.currentPageObj) {
            // Current page exists, go to edit it.
            const pageParams: any = {
                module: this.module,
                courseId: this.courseId,
                pageId: this.currentPageObj.id,
                pageTitle: this.currentPageObj.title,
                subwikiId: this.currentPageObj.subwikiid
            };

            if (this.currentSubwiki) {
                pageParams.wikiId = this.currentSubwiki.wikiid;
                pageParams.userId = this.currentSubwiki.userid;
                pageParams.groupId = this.currentSubwiki.groupid;
            }

            this.navCtrl.push('AddonModWikiEditPage', pageParams);
        } else if (this.currentSubwiki) {
            // No page loaded, the wiki doesn't have first page.
            this.goToCreateFirstPage();
        }
    }

    /**
     * Go to the view to create a new page.
     */
    goToNewPage(): void {
        if (!this.canEdit) {
            return;
        }

        if (this.currentPageObj) {
            // Current page exists, go to edit it.
            const pageParams: any = {
                module: this.module,
                courseId: this.courseId,
                subwikiId: this.currentPageObj.subwikiid
            };

            if (this.currentSubwiki) {
                pageParams.wikiId = this.currentSubwiki.wikiid;
                pageParams.userId = this.currentSubwiki.userid;
                pageParams.groupId = this.currentSubwiki.groupid;
            }

            this.navCtrl.push('AddonModWikiEditPage', pageParams);
        } else if (this.currentSubwiki) {
            // No page loaded, the wiki doesn't have first page.
            this.goToCreateFirstPage();
        }
    }

    /**
     * Go to view a certain page.
     *
     * @param page Page to view.
     */
    protected goToPage(page: any): void {
        if (!page.id) {
            // It's an offline page. Check if we are already in the same offline page.
            if (this.currentPage || !this.pageTitle || page.title != this.pageTitle) {
                this.navCtrl.push('AddonModWikiIndexPage', {
                    module: this.module,
                    courseId: this.courseId,
                    pageTitle: page.title,
                    wikiId: this.wiki.id,
                    subwikiId: page.subwikiid
                });

                return;
            }
        } else if (this.currentPage != page.id) {
            // Add a new State.
            this.fetchPageContents(page.id).then((page) => {
                this.navCtrl.push('AddonModWikiIndexPage', {
                    module: this.module,
                    courseId: this.courseId,
                    pageTitle: page.title,
                    pageId: page.id,
                    wikiId: page.wikiid,
                    subwikiId: page.subwikiid
                });
            });

            return;
        }
    }

    /**
     * Show the map.
     *
     * @param event Event.
     */
    openMap(event?: MouseEvent): void {
        const modal = this.modalCtrl.create('AddonModWikiMapPage', {
            pages: this.subwikiPages,
            selected: this.currentPageObj && this.currentPageObj.id,
            homeView: this.getWikiHomeView(),
            moduleId: this.module.id,
            courseId: this.courseId
        }, { cssClass: 'core-modal-lateral',
            showBackdrop: true,
            enableBackdropDismiss: true,
            enterAnimation: 'core-modal-lateral-transition',
            leaveAnimation: 'core-modal-lateral-transition' });

        // If the modal sends back a page, load it.
        modal.onDidDismiss((page) => {
            if (page) {
                if (page.type == 'home') {
                    // Go back to the initial page of the wiki.
                    this.navCtrl.popTo(page.goto);
                } else {
                    this.goToPage(page.goto);
                }
            }
        });

        modal.present({
            ev: event
        });
    }

    /**
     * Go to the page to view a certain subwiki.
     *
     * @param subwikiId Subwiki ID.
     * @param userId User ID of the subwiki.
     * @param groupId Group ID of the subwiki.
     * @param canEdit Whether the subwiki can be edited.
     */
    goToSubwiki(subwikiId: number, userId: number, groupId: number, canEdit: boolean): void {
        // Check if the subwiki is disabled.
        if (subwikiId > 0 || canEdit) {
            if (subwikiId != this.currentSubwiki.id || userId != this.currentSubwiki.userid ||
                    groupId != this.currentSubwiki.groupid) {

                this.navCtrl.push('AddonModWikiIndexPage', {
                    module: this.module,
                    courseId: this.courseId,
                    wikiId: this.wiki.id,
                    subwikiId: subwikiId,
                    userId: userId,
                    groupId: groupId
                });
            }
        }
    }

    /**
     * Checks if there is any subwiki selected.
     *
     * @return Whether there is any subwiki selected.
     */
    protected isAnySubwikiSelected(): boolean {
        return this.subwikiData.subwikiSelected > 0 || this.subwikiData.userSelected > 0 || this.subwikiData.groupSelected > 0;
    }

    /**
     * Checks if the given subwiki is the one picked on the subwiki picker.
     *
     * @param subwiki Subwiki to check.
     * @return Whether it's the selected subwiki.
     */
    protected isSubwikiSelected(subwiki: any): boolean {
        const subwikiId = parseInt(subwiki.id, 10) || 0;

        if (subwikiId > 0 && this.subwikiData.subwikiSelected > 0) {
            return subwikiId == this.subwikiData.subwikiSelected;
        }

        const userId = parseInt(subwiki.userid, 10) || 0,
            groupId = parseInt(subwiki.groupid, 10) || 0;

        return userId == this.subwikiData.userSelected && groupId == this.subwikiData.groupSelected;
    }

    /**
     * Replace edit links to have full url.
     *
     * @param content Content to treat.
     * @return Treated content.
     */
    protected replaceEditLinks(content: string): string {
        content = content.trim();

        if (content.length > 0) {
            const editUrl = this.textUtils.concatenatePaths(this.sitesProvider.getCurrentSite().getURL(), '/mod/wiki/edit.php');
            content = content.replace(/href="edit\.php/g, 'href="' + editUrl);
        }

        return content;
    }

    /**
     * Sets the selected subwiki for the subwiki picker.
     *
     * @param subwikiId Subwiki ID to select.
     * @param userId User ID of the subwiki to select.
     * @param groupId Group ID of the subwiki to select.
     */
    protected setSelectedWiki(subwikiId: number, userId: number, groupId: number): void {
        this.subwikiData.subwikiSelected = this.wikiOffline.convertToPositiveNumber(subwikiId);
        this.subwikiData.userSelected = this.wikiOffline.convertToPositiveNumber(userId);
        this.subwikiData.groupSelected = this.wikiOffline.convertToPositiveNumber(groupId);
    }

    /**
     * Checks if sync has succeed from result sync data.
     *
     * @param result Data returned on the sync function.
     * @return If suceed or not.
     */
    protected hasSyncSucceed(result: any): boolean {
        result.wikiId = this.wiki.id;

        if (result.updated) {
            // Trigger event.
            this.ignoreManualSyncEvent = true;
            this.eventsProvider.trigger(AddonModWikiSyncProvider.MANUAL_SYNCED, result);
        }

        if (this.currentSubwiki) {
            this.checkPageCreatedOrDiscarded(result.subwikis[this.currentSubwiki.id]);
        }

        return result.updated;
    }

    /**
     * User entered the page that contains the component.
     */
    ionViewDidEnter(): void {
        super.ionViewDidEnter();

        if (this.hasEdited) {
            this.hasEdited = false;
            this.showLoadingAndRefresh(true, false);
        }
    }

    /**
     * User left the page that contains the component.
     */
    ionViewDidLeave(): void {
        super.ionViewDidLeave();

        if (this.navCtrl.getActive().component.name == 'AddonModWikiEditPage') {
            this.hasEdited = true;
        }
    }

    /**
     * Perform the invalidate content function.
     *
     * @return Resolved when done.
     */
    protected invalidateContent(): Promise<any> {
        const promises = [];

        promises.push(this.wikiProvider.invalidateWikiData(this.courseId));

        if (this.wiki) {
            promises.push(this.wikiProvider.invalidateSubwikis(this.wiki.id));
            promises.push(this.groupsProvider.invalidateActivityAllowedGroups(this.wiki.coursemodule));
            promises.push(this.groupsProvider.invalidateActivityGroupMode(this.wiki.coursemodule));
        }

        if (this.currentSubwiki) {
            promises.push(this.wikiProvider.invalidateSubwikiPages(this.currentSubwiki.wikiid));
            promises.push(this.wikiProvider.invalidateSubwikiFiles(this.currentSubwiki.wikiid));
        }

        if (this.currentPage) {
            promises.push(this.wikiProvider.invalidatePage(this.currentPage));
        }

        return Promise.all(promises);
    }

    /**
     * Compares sync event data with current data to check if refresh content is needed.
     *
     * @param syncEventData Data receiven on sync observer.
     * @return True if refresh is needed, false otherwise.
     */
    protected isRefreshSyncNeeded(syncEventData: any): boolean {
        if (this.currentSubwiki && syncEventData.subwikiId == this.currentSubwiki.id &&
                syncEventData.wikiId == this.currentSubwiki.wikiid && syncEventData.userId == this.currentSubwiki.userid &&
                syncEventData.groupId == this.currentSubwiki.groupid) {

            if (this.isCurrentView && syncEventData.warnings && syncEventData.warnings.length) {
                // Show warnings.
                this.domUtils.showErrorModal(syncEventData.warnings[0]);
            }

            // Check if current page was created or discarded.
            this.checkPageCreatedOrDiscarded(syncEventData);
        }

        return !this.pageWarning;
    }

    /**
     * Show the TOC.
     *
     * @param event Event.
     */
    showSubwikiPicker(event: MouseEvent): void {
        const popover = this.popoverCtrl.create(AddonModWikiSubwikiPickerComponent, {
            subwikis: this.subwikiData.subwikis,
            currentSubwiki: this.currentSubwiki
        });

        popover.onDidDismiss((subwiki) => {
            if (subwiki) {
                this.goToSubwiki(subwiki.id, subwiki.userid, subwiki.groupid, subwiki.canedit);
            }
        });

        popover.present({
            ev: event
        });
    }

    /**
     * Performs the sync of the activity.
     *
     * @return Promise resolved when done.
     */
    protected sync(): Promise<any> {
        return this.wikiSync.syncWiki(this.wiki.id, this.courseId, this.wiki.coursemodule);
    }

    /**
     * Component being destroyed.
     */
    ngOnDestroy(): void {
        super.ngOnDestroy();

        this.manualSyncObserver && this.manualSyncObserver.off();
        this.newPageObserver && this.newPageObserver.off();
    }

    /**
     * Create the subwiki list for the selector and store it in the cache.
     *
     * @param userGroups Groups.
     * @return Promise resolved when done.
     */
    protected createSubwikiList(userGroups: any[]): Promise<any> {
        const subwikiList = [],
            promises = [];
        let userGroupsIds = [],
            allParticipants = false,
            showMyGroupsLabel = false,
            multiLevelList = false;

        this.subwikiData.subwikis = [];
        this.setSelectedWiki(this.subwikiId, this.userId, this.groupId);
        this.subwikiData.count = 0;

        // Group mode available.
        if (userGroups.length > 0) {
            userGroupsIds = userGroups.map((g) => {
                return g.id;
            });
        }

        // Add the subwikis to the subwikiList.
        this.loadedSubwikis.forEach((subwiki) => {
            const groupId = parseInt(subwiki.groupid, 10),
                userId = parseInt(subwiki.userid, 10);
            let groupLabel = '';

            if (groupId == 0 && userId == 0) {
                // Add 'All participants' subwiki if needed at the start.
                if (!allParticipants) {
                    subwikiList.unshift({
                        name: this.translate.instant('core.allparticipants'),
                        id: subwiki.id,
                        userid: userId,
                        groupid: groupId,
                        groupLabel: '',
                        canedit: subwiki.canedit
                    });
                    allParticipants = true;
                }
            } else {
                if (groupId != 0 && userGroupsIds.length > 0) {
                    // Get groupLabel if it has groupId.
                    const groupIdPosition = userGroupsIds.indexOf(groupId);
                    if (groupIdPosition > -1) {
                        groupLabel = userGroups[groupIdPosition].name;
                    }
                } else {
                    groupLabel = this.translate.instant('addon.mod_wiki.notingroup');
                }

                if (userId != 0) {
                    // Get user if it has userId.
                    promises.push(this.userProvider.getProfile(userId, this.courseId, true).then((user) => {
                        subwikiList.push({
                            name: user.fullname,
                            id: subwiki.id,
                            userid: userId,
                            groupid: groupId,
                            groupLabel: groupLabel,
                            canedit: subwiki.canedit
                        });

                    }));

                    if (!multiLevelList && groupId != 0) {
                        multiLevelList = true;
                    }
                } else {
                    subwikiList.push({
                        name: groupLabel,
                        id: subwiki.id,
                        userid: userId,
                        groupid: groupId,
                        groupLabel: groupLabel,
                        canedit: subwiki.canedit
                    });
                    showMyGroupsLabel = true;
                }
            }
        });

        return Promise.all(promises).then(() => {
            this.fillSubwikiData(subwikiList, showMyGroupsLabel, multiLevelList);
        });
    }

    /**
     * Fill the subwiki data.
     *
     * @param subwikiList List of subwikis.
     * @param showMyGroupsLabel Whether subwikis should be grouped in "My groups" and "Other groups".
     * @param multiLevelList Whether it's a multi level list.
     */
    protected fillSubwikiData(subwikiList: any[], showMyGroupsLabel: boolean, multiLevelList: boolean): void {
        let groupValue = -1,
            grouping;

        subwikiList.sort((a, b) => {
            return a.groupid - b.groupid;
        });

        this.groupWiki = showMyGroupsLabel;

        this.subwikiData.count = subwikiList.length;

        // If no subwiki is received as view param, select always the most appropiate.
        if ((!this.subwikiId || (!this.userId && !this.groupId)) && !this.isAnySubwikiSelected() && subwikiList.length > 0) {
            let firstCanEdit,
                candidateNoFirstPage,
                candidateFirstPage;

            for (const i in subwikiList) {
                const subwiki = subwikiList[i];

                if (subwiki.canedit) {
                    let candidateSubwikiId;
                    if (subwiki.userid > 0) {
                        // Check if it's the current user.
                        if (this.currentUserId == subwiki.userid) {
                            candidateSubwikiId = subwiki.id;
                        }
                    } else if (subwiki.groupid > 0) {
                        // Check if it's a current user' group.
                        if (showMyGroupsLabel) {
                            candidateSubwikiId = subwiki.id;
                        }
                    } else if (subwiki.id > 0) {
                        candidateSubwikiId = subwiki.id;
                    }

                    if (typeof candidateSubwikiId != 'undefined') {
                        if (candidateSubwikiId > 0) {
                            // Subwiki found and created, no need to keep looking.
                            candidateFirstPage = i;
                            break;
                        } else if (typeof candidateNoFirstPage == 'undefined') {
                            candidateNoFirstPage = i;
                        }
                    } else if (typeof firstCanEdit == 'undefined') {
                        firstCanEdit = i;
                    }
                }
            }

            let subWikiToTake;
            if (typeof candidateFirstPage != 'undefined') {
                // Take the candidate that already has the first page created.
                subWikiToTake = candidateFirstPage;
            } else if (typeof candidateNoFirstPage != 'undefined') {
                // No first page created, take the first candidate.
                subWikiToTake = candidateNoFirstPage;
            } else if (typeof firstCanEdit != 'undefined') {
                // None selected, take the first the user can edit.
                subWikiToTake = firstCanEdit;
            } else {
                // Otherwise take the very first.
                subWikiToTake = 0;
            }

            const subwiki = subwikiList[subWikiToTake];
            if (typeof subwiki != 'undefined') {
                this.setSelectedWiki(subwiki.id, subwiki.userid, subwiki.groupid);
            }
        }

        if (multiLevelList) {
            // As we loop over each subwiki, add it to the current group
            subwikiList.forEach((subwiki) => {
                // Should we create a new grouping?
                if (subwiki.groupid !== groupValue) {
                    grouping = {label: subwiki.groupLabel, subwikis: []};
                    groupValue = subwiki.groupid;

                    this.subwikiData.subwikis.push(grouping);
                }

                // Add the subwiki to the currently active grouping.
                grouping.subwikis.push(subwiki);
            });
        } else if (showMyGroupsLabel) {
            const noGrouping = {label: '', subwikis: []},
                myGroupsGrouping = {label: this.translate.instant('core.mygroups'), subwikis: []},
                otherGroupsGrouping = {label: this.translate.instant('core.othergroups'), subwikis: []};

            // As we loop over each subwiki, add it to the current group
            subwikiList.forEach((subwiki) => {
                // Add the subwiki to the currently active grouping.
                if (typeof subwiki.canedit == 'undefined') {
                    noGrouping.subwikis.push(subwiki);
                } else if (subwiki.canedit) {
                    myGroupsGrouping.subwikis.push(subwiki);
                } else {
                    otherGroupsGrouping.subwikis.push(subwiki);
                }
            });

            // Add each grouping to the subwikis
            if (noGrouping.subwikis.length > 0) {
                this.subwikiData.subwikis.push(noGrouping);
            }
            if (myGroupsGrouping.subwikis.length > 0) {
                this.subwikiData.subwikis.push(myGroupsGrouping);
            }
            if (otherGroupsGrouping.subwikis.length > 0) {
                this.subwikiData.subwikis.push(otherGroupsGrouping);
            }
        } else {
            this.subwikiData.subwikis.push({label: '', subwikis: subwikiList});
        }

        this.wikiProvider.setSubwikiList(this.wiki.id, this.subwikiData.subwikis, this.subwikiData.count,
                this.subwikiData.subwikiSelected, this.subwikiData.userSelected, this.subwikiData.groupSelected);
    }
}
