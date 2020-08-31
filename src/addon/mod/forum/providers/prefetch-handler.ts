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

import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CoreAppProvider } from '@providers/app';
import { CoreFilepoolProvider } from '@providers/filepool';
import { CoreSitesProvider } from '@providers/sites';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreUtilsProvider } from '@providers/utils/utils';
import { CoreCourseProvider } from '@core/course/providers/course';
import { CoreUserProvider } from '@core/user/providers/user';
import { CoreCourseActivityPrefetchHandlerBase } from '@core/course/classes/activity-prefetch-handler';
import { CoreGroupsProvider } from '@providers/groups';
import { AddonModForumProvider } from './forum';
import { AddonModForumSyncProvider } from './sync';
import { CoreFilterHelperProvider } from '@core/filter/providers/helper';
import { CorePluginFileDelegate } from '@providers/plugin-file-delegate';

/**
 * Handler to prefetch forums.
 */
@Injectable()
export class AddonModForumPrefetchHandler extends CoreCourseActivityPrefetchHandlerBase {
    name = 'AddonModForum';
    modName = 'forum';
    component = AddonModForumProvider.COMPONENT;
    updatesNames = /^configuration$|^.*files$|^discussions$/;

    constructor(translate: TranslateService,
            appProvider: CoreAppProvider,
            utils: CoreUtilsProvider,
            courseProvider: CoreCourseProvider,
            filepoolProvider: CoreFilepoolProvider,
            sitesProvider: CoreSitesProvider,
            domUtils: CoreDomUtilsProvider,
            filterHelper: CoreFilterHelperProvider,
            pluginFileDelegate: CorePluginFileDelegate,
            private userProvider: CoreUserProvider,
            private groupsProvider: CoreGroupsProvider,
            private forumProvider: AddonModForumProvider,
            private syncProvider: AddonModForumSyncProvider) {

        super(translate, appProvider, utils, courseProvider, filepoolProvider, sitesProvider, domUtils, filterHelper,
                pluginFileDelegate);
    }

    /**
     * Get list of files. If not defined, we'll assume they're in module.contents.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @return Promise resolved with the list of files.
     */
    getFiles(module: any, courseId: number, single?: boolean): Promise<any[]> {
        return this.forumProvider.getForum(courseId, module.id).then((forum) => {
            const files = this.getIntroFilesFromInstance(module, forum);

            // Get posts.
            return this.getPostsForPrefetch(forum).then((posts) => {
                // Add posts attachments and embedded files.
                return files.concat(this.getPostsFiles(posts));
            });
        }).catch(() => {
            // Forum not found, return empty list.
            return [];
        });
    }

    /**
     * Given a list of forum posts, return a list with all the files (attachments and embedded files).
     *
     * @param posts Forum posts.
     * @return Files.
     */
    protected getPostsFiles(posts: any[]): any[] {
        let files = [];
        const getInlineFiles = this.sitesProvider.getCurrentSite() &&
                this.sitesProvider.getCurrentSite().isVersionGreaterEqualThan('3.2');

        posts.forEach((post) => {
            if (post.attachments && post.attachments.length) {
                files = files.concat(post.attachments);
            }
            if (getInlineFiles && post.messageinlinefiles && post.messageinlinefiles.length) {
                files = files.concat(post.messageinlinefiles);
            } else if (post.message && !getInlineFiles) {
                files = files.concat(this.filepoolProvider.extractDownloadableFilesFromHtmlAsFakeFileObjects(post.message));
            }
        });

        return files;
    }

    /**
     * Get the posts to be prefetched.
     *
     * @param forum Forum instance.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved with array of posts.
     */
    protected getPostsForPrefetch(forum: any, siteId?: string): Promise<any[]> {
        const promises = this.forumProvider.getAvailableSortOrders().map((sortOrder) => {
            // Get discussions in first 2 pages.
            return this.forumProvider.getDiscussionsInPages(forum.id, sortOrder.value, false, 2, 0, siteId).then((response) => {
                if (response.error) {
                    return Promise.reject(null);
                }

                const promises = [];

                response.discussions.forEach((discussion) => {
                    promises.push(this.forumProvider.getDiscussionPosts(discussion.discussion, siteId));
                });

              return Promise.all(promises);
            });
        });

        return Promise.all(promises).then((results) => {
            // Each order has returned its own list of posts. Merge all the lists, preventing duplicates.
            const posts = [],
                postIds = {}; // To make the array unique.

            results.forEach((orderResults) => {
                orderResults.forEach((orderResult) => {
                    orderResult.posts.forEach((post) => {
                        if (!postIds[post.id]) {
                            postIds[post.id] = true;
                            posts.push(post);
                        }
                    });
                });
            });

            return posts;
        });
    }

    /**
     * Invalidate the prefetched content.
     *
     * @param moduleId The module ID.
     * @param courseId The course ID the module belongs to.
     * @return Promise resolved when the data is invalidated.
     */
    invalidateContent(moduleId: number, courseId: number): Promise<any> {
        return this.forumProvider.invalidateContent(moduleId, courseId);
    }

    /**
     * Invalidate WS calls needed to determine module status (usually, to check if module is downloadable).
     * It doesn't need to invalidate check updates. It should NOT invalidate files nor all the prefetched data.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @return Promise resolved when invalidated.
     */
    invalidateModule(module: any, courseId: number): Promise<any> {
        // Invalidate forum data to recalculate unread message count badge.
        const promises = [];

        promises.push(this.forumProvider.invalidateForumData(courseId));
        promises.push(this.courseProvider.invalidateModule(module.id));

        return Promise.all(promises);
    }

    /**
     * Prefetch a module.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @param dirPath Path of the directory where to store all the content files.
     * @return Promise resolved when done.
     */
    prefetch(module: any, courseId?: number, single?: boolean, dirPath?: string): Promise<any> {
        return this.prefetchPackage(module, courseId, single, this.prefetchForum.bind(this));
    }

    /**
     * Prefetch a forum.
     *
     * @param module The module object returned by WS.
     * @param courseId Course ID the module belongs to.
     * @param single True if we're downloading a single module, false if we're downloading a whole section.
     * @param siteId Site ID.
     * @return Promise resolved when done.
     */
    protected prefetchForum(module: any, courseId: number, single: boolean, siteId: string): Promise<any> {
        // Get the forum data.
        return this.forumProvider.getForum(courseId, module.id, siteId).then((forum) => {
            const promises = [];

            // Prefetch the posts.
            promises.push(this.getPostsForPrefetch(forum, siteId).then((posts) => {
                const promises = [];

                const files = this.getIntroFilesFromInstance(module, forum).concat(this.getPostsFiles(posts));
                promises.push(this.filepoolProvider.addFilesToQueue(siteId, files, this.component, module.id));

                // Prefetch groups data.
                promises.push(this.prefetchGroupsInfo(forum, courseId, forum.cancreatediscussions, siteId));

                // Prefetch avatars.
                promises.push(this.userProvider.prefetchUserAvatars(posts, 'userpictureurl', siteId));

                return Promise.all(promises);
            }));

            // Prefetch access information.
            promises.push(this.forumProvider.getAccessInformation(forum.id, false, siteId));

            // Prefetch sort order preference.
            if (this.forumProvider.isDiscussionListSortingAvailable()) {
               promises.push(this.userProvider.getUserPreference(AddonModForumProvider.PREFERENCE_SORTORDER, siteId));
            }

            return Promise.all(promises);
        });
    }

    /**
     * Prefetch groups info for a forum.
     *
     * @param module The module object returned by WS.
     * @param courseI Course ID the module belongs to.
     * @param canCreateDiscussions Whether the user can create discussions in the forum.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved when group data has been prefetched.
     */
    protected prefetchGroupsInfo(forum: any, courseId: number, canCreateDiscussions: boolean, siteId?: string): any {
        // Check group mode.
        return this.groupsProvider.getActivityGroupMode(forum.cmid, siteId).then((mode) => {
            if (mode !== CoreGroupsProvider.SEPARATEGROUPS && mode !== CoreGroupsProvider.VISIBLEGROUPS) {
                // Activity doesn't use groups. Prefetch canAddDiscussionToAll to determine if user can pin/attach.
                return this.forumProvider.canAddDiscussionToAll(forum.id, siteId).catch(() => {
                        // Ignore errors.
                });
            }

            // Activity uses groups, prefetch allowed groups.
            return this.groupsProvider.getActivityAllowedGroups(forum.cmid, undefined, siteId).then((result) => {
                if (mode === CoreGroupsProvider.SEPARATEGROUPS) {
                    // Groups are already filtered by WS. Prefetch canAddDiscussionToAll to determine if user can pin/attach.
                    return this.forumProvider.canAddDiscussionToAll(forum.id, siteId).catch(() => {
                        // Ignore errors.
                    });
                }

                if (canCreateDiscussions) {
                    // Prefetch data to check the visible groups when creating discussions.
                    return this.forumProvider.canAddDiscussionToAll(forum.id, siteId).catch(() => {
                        // The call failed, let's assume he can't.
                        return {
                            status: false
                        };
                    }).then((response) => {
                        if (response.status) {
                            // User can post to all groups, nothing else to prefetch.
                            return;
                        }

                        // The user can't post to all groups, let's check which groups he can post to.
                        const groupPromises = [];
                        result.groups.forEach((group) => {
                            groupPromises.push(this.forumProvider.canAddDiscussion(forum.id, group.id, siteId).catch(() => {
                                // Ignore errors.
                            }));
                        });

                        return Promise.all(groupPromises);
                    });
                }
            });
        }).catch((error) => {
            // Ignore errors if cannot create discussions.
            if (canCreateDiscussions) {
                return Promise.reject(error);
            }
        });
    }

    /**
     * Sync a module.
     *
     * @param module Module.
     * @param courseId Course ID the module belongs to
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved when done.
     */
    sync(module: any, courseId: number, siteId?: any): Promise<any> {
        const promises = [];

        promises.push(this.syncProvider.syncForumDiscussions(module.instance, undefined, siteId));
        promises.push(this.syncProvider.syncForumReplies(module.instance, undefined, siteId));
        promises.push(this.syncProvider.syncRatings(module.id, undefined, true, siteId));

        return Promise.all(promises).then((results) => {
            return results.reduce((a, b) => ({
                updated: a.updated || b.updated,
                warnings: (a.warnings || []).concat(b.warnings || []),
            }), {updated: false});
        });
    }
}
