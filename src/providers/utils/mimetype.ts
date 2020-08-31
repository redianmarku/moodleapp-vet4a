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
import { HttpClient } from '@angular/common/http';
import { CoreFile } from '../file';
import { CoreLoggerProvider } from '../logger';
import { TranslateService } from '@ngx-translate/core';
import { CoreTextUtilsProvider } from './text';
import { makeSingleton } from '@singletons/core.singletons';

/*
 * "Utils" service with helper functions for mimetypes and extensions.
 */
@Injectable()
export class CoreMimetypeUtilsProvider {
    protected logger;
    protected extToMime = {}; // Object to map extensions -> mimetypes.
    protected mimeToExt = {}; // Object to map mimetypes -> extensions.
    protected groupsMimeInfo = {}; // Object to hold extensions and mimetypes that belong to a certain "group" (audio, video, ...).
    protected extensionRegex = /^[a-z0-9]+$/;

    constructor(http: HttpClient, logger: CoreLoggerProvider, private translate: TranslateService,
            private textUtils: CoreTextUtilsProvider) {
        this.logger = logger.getInstance('CoreMimetypeUtilsProvider');

        http.get('assets/exttomime.json').subscribe((result) => {
            this.extToMime = result;
        }, (err) => {
            // Error, shouldn't happen.
        });

        http.get('assets/mimetoext.json').subscribe((result) => {
            this.mimeToExt = result;
        }, (err) => {
            // Error, shouldn't happen.
        });
    }

    /**
     * Check if a file extension can be embedded without using iframes.
     *
     * @param extension Extension.
     * @return Whether it can be embedded.
     */
    canBeEmbedded(extension: string): boolean {
        return this.isExtensionInGroup(extension, ['web_image', 'web_video', 'web_audio']);
    }

    /**
     * Clean a extension, removing the dot, hash, extra params...
     *
     * @param extension Extension to clean.
     * @return Clean extension.
     */
    cleanExtension(extension: string): string {
        if (!extension) {
            return extension;
        }

        // If the extension has parameters, remove them.
        let position = extension.indexOf('?');
        if (position > -1) {
            extension = extension.substr(0, position);
        }

        // If the extension has an anchor, remove it.
        position = extension.indexOf('#');
        if (position > -1) {
            extension = extension.substr(0, position);
        }

        // Remove hash in extension if there's any (added by filepool).
        extension = extension.replace(/_.{32}$/, '');

        // Remove dot from the extension if found.
        if (extension && extension[0] == '.') {
            extension = extension.substr(1);
        }

        return extension;
    }

    /**
     * Fill the mimetypes and extensions info for a certain group.
     *
     * @param group Group name.
     */
    protected fillGroupMimeInfo(group: string): void {
        const mimetypes = {}, // Use an object to prevent duplicates.
            extensions = []; // Extensions are unique.

        for (const extension in this.extToMime) {
            const data = this.extToMime[extension];
            if (data.type && data.groups && data.groups.indexOf(group) != -1) {
                // This extension has the group, add it to the list.
                mimetypes[data.type] = true;
                extensions.push(extension);
            }
        }

        this.groupsMimeInfo[group] = {
            mimetypes: Object.keys(mimetypes),
            extensions: extensions
        };
    }

    /**
     * Get the extension of a mimetype. Returns undefined if not found.
     *
     * @param mimetype Mimetype.
     * @param url URL of the file. It will be used if there's more than one possible extension.
     * @return Extension.
     */
    getExtension(mimetype: string, url?: string): string {
        mimetype = mimetype || '';
        mimetype = mimetype.split(';')[0]; // Remove codecs from the mimetype if any.

        if (mimetype == 'application/x-forcedownload' || mimetype == 'application/forcedownload') {
            // Couldn't get the right mimetype, try to guess it.
            return this.guessExtensionFromUrl(url);
        }

        const extensions = this.mimeToExt[mimetype];
        if (extensions && extensions.length) {
            if (extensions.length > 1 && url) {
                // There's more than one possible extension. Check if the URL has extension.
                const candidate = this.guessExtensionFromUrl(url);
                if (extensions.indexOf(candidate) != -1) {
                    return candidate;
                }
            }

            return extensions[0];
        }
    }

    /**
     * Set the embed type to display an embedded file and mimetype if not found.
     *
     * @param file File object.
     * @paran path Alternative path that will override fileurl from file object.
     */
    getEmbeddedHtml(file: any, path?: string): string {
        let ext;
        const filename = file.filename || file.name;

        if (file.mimetype) {
            ext = this.getExtension(file.mimetype);
        } else {
            ext = this.getFileExtension(filename);
            file.mimetype = this.getMimeType(ext);
        }

        if (this.canBeEmbedded(ext)) {
            file.embedType = this.getExtensionType(ext);

            path = CoreFile.instance.convertFileSrc(path || file.fileurl || (file.toURL && file.toURL()));

            if (file.embedType == 'image') {
                return '<img src="' + path + '">';
            }
            if (file.embedType == 'audio' || file.embedType == 'video') {
                return '<' + file.embedType + ' controls title="' + filename + '" src="' + path + '">' +
                    '<source src="' + path + '" type="' + file.mimetype + '">' +
                    '</' + file.embedType + '>';
            }
        }

        return '';
    }

    /**
     * Get the URL of the icon of an extension.
     *
     * @param extension Extension.
     * @return Icon URL.
     */
    getExtensionIcon(extension: string): string {
        const icon = this.getExtensionIconName(extension) || 'unknown';

        return this.getFileIconForType(icon);
    }

    /**
     * Get the name of the icon of an extension.
     *
     * @param extension Extension.
     * @return Icon. Undefined if not found.
     */
    getExtensionIconName(extension: string): string {
        if (this.extToMime[extension]) {
            if (this.extToMime[extension].icon) {
                return this.extToMime[extension].icon;
            } else {
                const type = this.extToMime[extension].type.split('/')[0];
                if (type == 'video' || type == 'text' || type == 'image' || type == 'document' || type == 'audio') {
                    return type;
                }
            }
        }
    }

    /**
     * Get the "type" (string) of an extension, something like "image", "video" or "audio".
     *
     * @param extension Extension.
     * @return Type of the extension.
     */
    getExtensionType(extension: string): string {
        extension = this.cleanExtension(extension);

        if (this.extToMime[extension] && this.extToMime[extension].string) {
            return this.extToMime[extension].string;
        }
    }

    /**
     * Get all the possible extensions of a mimetype. Returns empty array if not found.
     *
     * @param mimetype Mimetype.
     * @return Extensions.
     */
    getExtensions(mimetype: string): string[] {
        mimetype = mimetype || '';
        mimetype = mimetype.split(';')[0]; // Remove codecs from the mimetype if any.

        return this.mimeToExt[mimetype] || [];
    }

    /**
     * Get a file icon URL based on its file name.
     *
     * @param The name of the file.
     * @return The path to a file icon.
     */
    getFileIcon(filename: string): string {
        const ext = this.getFileExtension(filename),
            icon = this.getExtensionIconName(ext) || 'unknown';

        return this.getFileIconForType(icon);
    }

    /**
     * Get the folder icon URL.
     *
     * @return The path to a folder icon.
     */
    getFolderIcon(): string {
        return 'assets/img/files/folder-64.png';
    }

    /**
     * Given a type (audio, video, html, ...), return its file icon path.
     *
     * @param type The type to get the icon.
     * @return The icon path.
     */
    getFileIconForType(type: string): string {
        return 'assets/img/files/' + type + '-64.png';
    }

    /**
     * Guess the extension of a file from its URL.
     * This is very weak and unreliable.
     *
     * @param fileUrl The file URL.
     * @return The lowercased extension without the dot, or undefined.
     */
    guessExtensionFromUrl(fileUrl: string): string {
        const split = fileUrl.split('.');
        let candidate,
            extension,
            position;

        if (split.length > 1) {
            candidate = split.pop().toLowerCase();
            // Remove params if any.
            position = candidate.indexOf('?');
            if (position > -1) {
                candidate = candidate.substr(0, position);
            }

            if (this.extensionRegex.test(candidate)) {
                extension = candidate;
            }
        }

        // Check extension corresponds to a mimetype to know if it's valid.
        if (extension && typeof this.getMimeType(extension) == 'undefined') {
            this.logger.warn('Guess file extension: Not valid extension ' + extension);

            return;
        }

        return extension;
    }

    /**
     * Returns the file extension of a file.
     * When the file does not have an extension, it returns undefined.
     *
     * @param filename The file name.
     * @return The lowercased extension, or undefined.
     */
    getFileExtension(filename: string): string {
        const dot = filename.lastIndexOf('.');
        let ext;

        if (dot > -1) {
            ext = filename.substr(dot + 1).toLowerCase();
            ext = this.cleanExtension(ext);

            // Check extension corresponds to a mimetype to know if it's valid.
            if (typeof this.getMimeType(ext) == 'undefined') {
                this.logger.warn('Get file extension: Not valid extension ' + ext);

                return;
            }
        }

        return ext;
    }

    /**
     * Get the mimetype/extension info belonging to a certain group.
     *
     * @param group Group name.
     * @param field The field to get. If not supplied, all the info will be returned.
     * @return Info for the group.
     */
    getGroupMimeInfo(group: string, field?: string): any {
        if (typeof this.groupsMimeInfo[group] == 'undefined') {
            this.fillGroupMimeInfo(group);
        }

        if (field) {
            return this.groupsMimeInfo[group][field];
        }

        return this.groupsMimeInfo[group];
    }

    /**
     * Get the mimetype of an extension. Returns undefined if not found.
     *
     * @param extension Extension.
     * @return Mimetype.
     */
    getMimeType(extension: string): string {
        extension = this.cleanExtension(extension);

        if (this.extToMime[extension] && this.extToMime[extension].type) {
            return this.extToMime[extension].type;
        }
    }

    /**
     * Obtains descriptions for file types (e.g. 'Microsoft Word document') from the language file.
     * Based on Moodle's get_mimetype_description.
     *
     * @param obj Instance of FileEntry OR object with 'filename' and 'mimetype' OR string with mimetype.
     * @param capitalise If true, capitalises first character of result.
     * @return Type description.
     */
    getMimetypeDescription(obj: any, capitalise?: boolean): string {
        const langPrefix = 'assets.mimetypes.';
        let filename = '',
            mimetype = '',
            extension = '';

        if (typeof obj == 'object' && typeof obj.file == 'function') {
            // It's a FileEntry. Don't use the file function because it's asynchronous and the type isn't reliable.
            filename = obj.name;
        } else if (typeof obj == 'object') {
            filename = obj.filename || '';
            mimetype = obj.mimetype || '';
        } else {
            mimetype = obj;
        }

        if (filename) {
            extension = this.getFileExtension(filename);

            if (!mimetype) {
                // Try to calculate the mimetype using the extension.
                mimetype = this.getMimeType(extension);
            }
        }

        if (!mimetype) {
            // Don't have the mimetype, stop.
            return '';
        }

        if (!extension) {
            extension = this.getExtension(mimetype);
        }

        const mimetypeStr = this.getMimetypeType(mimetype) || '',
            chunks = mimetype.split('/'),
            attr = {
                mimetype: mimetype,
                ext: extension || '',
                mimetype1: chunks[0],
                mimetype2: chunks[1] || '',
            },
            translateParams = {};

        for (const key in attr) {
            const value = attr[key];
            translateParams[key] = value;
            translateParams[key.toUpperCase()] = value.toUpperCase();
            translateParams[this.textUtils.ucFirst(key)] = this.textUtils.ucFirst(value);
        }

        // MIME types may include + symbol but this is not permitted in string ids.
        const safeMimetype = mimetype.replace(/\+/g, '_'),
            safeMimetypeStr = mimetypeStr.replace(/\+/g, '_'),
            safeMimetypeTrns = this.translate.instant(langPrefix + safeMimetype, { $a: translateParams }),
            safeMimetypeStrTrns = this.translate.instant(langPrefix + safeMimetypeStr, { $a: translateParams }),
            defaultTrns = this.translate.instant(langPrefix + 'default', { $a: translateParams });
        let result = mimetype;

        if (safeMimetypeTrns != langPrefix + safeMimetype) {
            result = safeMimetypeTrns;
        } else if (safeMimetypeStrTrns != langPrefix + safeMimetypeStr) {
            result = safeMimetypeStrTrns;
        } else if (defaultTrns != langPrefix + 'default') {
            result = defaultTrns;
        }

        if (capitalise) {
            result = this.textUtils.ucFirst(result);
        }

        return result;
    }

    /**
     * Get the "type" (string) of a mimetype, something like "image", "video" or "audio".
     *
     * @param mimetype Mimetype.
     * @return Type of the mimetype.
     */
    getMimetypeType(mimetype: string): string {
        mimetype = mimetype.split(';')[0]; // Remove codecs from the mimetype if any.

        const extensions = this.mimeToExt[mimetype];
        if (!extensions) {
            return;
        }

        for (let i = 0; i < extensions.length; i++) {
            const extension = extensions[i];
            if (this.extToMime[extension] && this.extToMime[extension].string) {
                return this.extToMime[extension].string;
            }
        }
    }

    /**
     * Get the icon of a mimetype.
     *
     * @param mimetype Mimetype.
     * @return Type of the mimetype.
     */
    getMimetypeIcon(mimetype: string): string {
        mimetype = mimetype.split(';')[0]; // Remove codecs from the mimetype if any.

        const extensions = this.mimeToExt[mimetype] || [];
        let icon = 'unknown';

        for (let i = 0; i < extensions.length; i++) {
            const iconName = this.getExtensionIconName(extensions[i]);

            if (iconName) {
                icon = iconName;
                break;
            }
        }

        return this.getFileIconForType(icon);
    }

    /**
     * Given a group name, return the translated name.
     *
     * @param name Group name.
     * @return Translated name.
     */
    getTranslatedGroupName(name: string): string {
        const key = 'assets.mimetypes.group:' + name,
            translated = this.translate.instant(key);

        return translated != key ? translated : name;
    }

    /**
     * Check if an extension belongs to at least one of the groups.
     * Similar to Moodle's file_mimetype_in_typegroup, but using the extension instead of mimetype.
     *
     * @param extension Extension.
     * @param groups List of groups to check.
     * @return Whether the extension belongs to any of the groups.
     */
    isExtensionInGroup(extension: string, groups: string[]): boolean {
        extension = this.cleanExtension(extension);

        if (groups && groups.length && this.extToMime[extension] && this.extToMime[extension].groups) {
            for (let i = 0; i < this.extToMime[extension].groups.length; i++) {
                const group = this.extToMime[extension].groups[i];
                if (groups.indexOf(group) != -1) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Remove the extension from a path (if any).
     *
     * @param path Path.
     * @return Path without extension.
     */
    removeExtension(path: string): string {
        const position = path.lastIndexOf('.');
        let extension;

        if (position > -1) {
            // Check extension corresponds to a mimetype to know if it's valid.
            extension = path.substr(position + 1).toLowerCase();
            if (typeof this.getMimeType(extension) != 'undefined') {
                return path.substr(0, position); // Remove extension.
            }
        }

        return path;
    }
}

export class CoreMimetypeUtils extends makeSingleton(CoreMimetypeUtilsProvider) {}
