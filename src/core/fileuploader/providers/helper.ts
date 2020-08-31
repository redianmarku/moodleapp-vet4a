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
import { ActionSheetController, ActionSheet, Platform, Loading } from 'ionic-angular';
import { MediaFile } from '@ionic-native/media-capture';
import { Camera, CameraOptions } from '@ionic-native/camera';
import { Chooser, ChooserResult } from '@ionic-native/chooser';
import { TranslateService } from '@ngx-translate/core';
import { CoreAppProvider } from '@providers/app';
import { CoreFileProvider, CoreFileProgressEvent } from '@providers/file';
import { CoreLoggerProvider } from '@providers/logger';
import { CoreDomUtilsProvider } from '@providers/utils/dom';
import { CoreMimetypeUtils } from '@providers/utils/mimetype';
import { CoreTextUtilsProvider } from '@providers/utils/text';
import { CoreUtilsProvider, PromiseDefer } from '@providers/utils/utils';
import { CoreFileUploaderProvider, CoreFileUploaderOptions } from './fileuploader';
import { CoreFileUploaderDelegate } from './delegate';

/**
 * Helper service to upload files.
 */
@Injectable()
export class CoreFileUploaderHelperProvider {

    protected logger;
    protected filePickerDeferred: PromiseDefer;
    protected actionSheet: ActionSheet;

    constructor(logger: CoreLoggerProvider,
            protected appProvider: CoreAppProvider,
            protected translate: TranslateService,
            protected fileUploaderProvider: CoreFileUploaderProvider,
            protected domUtils: CoreDomUtilsProvider,
            protected textUtils: CoreTextUtilsProvider,
            protected fileProvider: CoreFileProvider,
            protected utils: CoreUtilsProvider,
            protected actionSheetCtrl: ActionSheetController,
            protected uploaderDelegate: CoreFileUploaderDelegate,
            protected camera: Camera,
            protected platform: Platform,
            protected fileChooser: Chooser) {
        this.logger = logger.getInstance('CoreFileUploaderProvider');
    }

    /**
     * Choose any type of file and upload it.
     *
     * @param maxSize Max size of the upload. -1 for no max size.
     * @param upload True if the file should be uploaded, false to return the picked file.
     * @param mimetypes List of supported mimetypes. If undefined, all mimetypes supported.
     * @param allowOffline True to allow uploading in offline.
     * @return Promise resolved when done.
     */
    async chooseAndUploadFile(maxSize: number, upload?: boolean, allowOffline?: boolean, mimetypes?: string[]): Promise<any> {

        const modal = this.domUtils.showModalLoading();

        const result = await this.fileChooser.getFile(mimetypes ? mimetypes.join(',') : undefined);

        modal.dismiss();

        if (!result) {
            // User canceled.
            throw this.domUtils.createCanceledError();
        }

        if (result.name == 'File') {
            // In some Android 4.4 devices the file name cannot be retrieved. Try to use the one from the URI.
            result.name = this.getChosenFileNameFromPath(result) || result.name;
        }

        // Verify that the mimetype is supported.
        const error = this.fileUploaderProvider.isInvalidMimetype(mimetypes, result.name, result.mediaType);

        if (error) {
            return Promise.reject(error);
        }

        const options = this.fileUploaderProvider.getFileUploadOptions(result.uri, result.name, result.mediaType, true);

        if (upload) {
            return this.uploadFile(result.uri, maxSize, true, options);
        } else {
            return this.copyToTmpFolder(result.uri, false, maxSize, undefined, options);
        }
    }

    /**
     * Show a confirmation modal to the user if the size of the file is bigger than the allowed threshold.
     *
     * @param size File size.
     * @param alwaysConfirm True to show a confirm even if the size isn't high.
     * @param allowOffline True to allow uploading in offline.
     * @param wifiThreshold Threshold for WiFi connection. Default: CoreFileUploaderProvider.WIFI_SIZE_WARNING.
     * @param limitedThreshold Threshold for limited connection. Default: CoreFileUploaderProvider.LIMITED_SIZE_WARNING.
     * @return Promise resolved when the user confirms or if there's no need to show a modal.
     */
    confirmUploadFile(size: number, alwaysConfirm?: boolean, allowOffline?: boolean, wifiThreshold?: number,
            limitedThreshold?: number): Promise<void> {
        if (size == 0) {
            return Promise.resolve();
        }

        if (!allowOffline && !this.appProvider.isOnline()) {
            return Promise.reject(this.translate.instant('core.fileuploader.errormustbeonlinetoupload'));
        }

        wifiThreshold = typeof wifiThreshold == 'undefined' ? CoreFileUploaderProvider.WIFI_SIZE_WARNING : wifiThreshold;
        limitedThreshold = typeof limitedThreshold == 'undefined' ?
            CoreFileUploaderProvider.LIMITED_SIZE_WARNING : limitedThreshold;

        if (size < 0) {
            return this.domUtils.showConfirm(this.translate.instant('core.fileuploader.confirmuploadunknownsize'));
        } else if (size >= wifiThreshold || (this.appProvider.isNetworkAccessLimited() && size >= limitedThreshold)) {
            const readableSize = this.textUtils.bytesToSize(size, 2);

            return this.domUtils.showConfirm(this.translate.instant('core.fileuploader.confirmuploadfile', { size: readableSize }));
        } else if (alwaysConfirm) {
            return this.domUtils.showConfirm(this.translate.instant('core.areyousure'));
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Create a temporary copy of a file and upload it.
     *
     * @param file File to copy and upload.
     * @param upload True if the file should be uploaded, false to return the copy of the file.
     * @param name Name to use when uploading the file. If not defined, use the file's name.
     * @return Promise resolved when the file is uploaded.
     */
    copyAndUploadFile(file: any, upload?: boolean, name?: string): Promise<any> {
        name = name || file.name;

        const modal = this.domUtils.showModalLoading('core.fileuploader.readingfile', true);

        // Get unique name for the copy.
        return this.fileProvider.getUniqueNameInFolder(CoreFileProvider.TMPFOLDER, name).then((newName) => {
            const filePath = this.textUtils.concatenatePaths(CoreFileProvider.TMPFOLDER, newName);

            // Write the data into the file.
            return this.fileProvider.writeFileDataInFile(file, filePath, (progress: CoreFileProgressEvent) => {
                this.showProgressModal(modal, 'core.fileuploader.readingfileperc', progress);
            });
        }).catch((error) => {
            this.logger.error('Error reading file to upload.', error);
            modal.dismiss();

            return Promise.reject(error);
        }).then((fileEntry) => {
            modal.dismiss();

            if (upload) {
                // Pass true to delete the copy after the upload.
                return this.uploadGenericFile(fileEntry.toURL(), name, file.type, true);
            } else {
                return fileEntry;
            }
        });
    }

    /**
     * Copy or move a file to the app temporary folder.
     *
     * @param path Path of the file.
     * @param shouldDelete True if original file should be deleted (move), false otherwise (copy).
     * @param maxSize Max size of the file. If not defined or -1, no max size.
     * @param defaultExt Defaut extension to use if the file doesn't have any.
     * @return Promise resolved with the copied file.
     */
    protected copyToTmpFolder(path: string, shouldDelete: boolean, maxSize?: number, defaultExt?: string,
            options?: CoreFileUploaderOptions): Promise<any> {

        const fileName = (options && options.fileName) || this.fileProvider.getFileAndDirectoryFromPath(path).name;
        let promise;
        let fileTooLarge;

        // Check that size isn't too large.
        if (typeof maxSize != 'undefined' && maxSize != -1) {
            promise = this.fileProvider.getExternalFile(path).then((fileEntry) => {
                return this.fileProvider.getFileObjectFromFileEntry(fileEntry).then((file) => {
                    if (file.size > maxSize) {
                        fileTooLarge = file;
                    }
                });
            }).catch(() => {
                // Ignore failures.
            });
        } else {
            promise = Promise.resolve();
        }

        return promise.then(() => {
            if (fileTooLarge) {
                return this.errorMaxBytes(maxSize, fileTooLarge.name);
            }

            // File isn't too large.
            // Get a unique name in the folder to prevent overriding another file.
            return this.fileProvider.getUniqueNameInFolder(CoreFileProvider.TMPFOLDER, fileName, defaultExt);
        }).then((newName) => {
            // Now move or copy the file.
            const destPath = this.textUtils.concatenatePaths(CoreFileProvider.TMPFOLDER, newName);
            if (shouldDelete) {
                return this.fileProvider.moveExternalFile(path, destPath);
            } else {
                return this.fileProvider.copyExternalFile(path, destPath);
            }
        });
    }

    /**
     * Function called when trying to upload a file bigger than max size. Shows an error.
     *
     * @param maxSize Max size (bytes).
     * @param fileName Name of the file.
     * @return Rejected promise.
     */
    protected errorMaxBytes(maxSize: number, fileName: string): Promise<any> {
        const errorMessage = this.translate.instant('core.fileuploader.maxbytesfile', {
            $a: {
                file: fileName,
                size: this.textUtils.bytesToSize(maxSize, 2)
            }
        });

        return Promise.reject(errorMessage);
    }

    /**
     * Function called when the file picker is closed.
     */
    filePickerClosed(): void {
        if (this.filePickerDeferred) {
            this.filePickerDeferred.reject(this.domUtils.createCanceledError());
            this.filePickerDeferred = undefined;
        }
    }

    /**
     * Function to call once a file is uploaded using the file picker.
     *
     * @param result Result of the upload process.
     */
    fileUploaded(result: any): void {
        if (this.filePickerDeferred) {
            this.filePickerDeferred.resolve(result);
            this.filePickerDeferred = undefined;
        }
        // Close the action sheet if it's opened.
        if (this.actionSheet) {
            this.actionSheet.dismiss();
        }
    }

    /**
     * Given the result of choosing a file, try to get its file name from the path.
     *
     * @param result Chosen file data.
     * @return File name, undefined if cannot get it.
     */
    protected getChosenFileNameFromPath(result: ChooserResult): string {
        const nameAndDir = this.fileProvider.getFileAndDirectoryFromPath(result.uri);

        if (!nameAndDir.name) {
            return;
        }

        let extension = CoreMimetypeUtils.instance.getFileExtension(nameAndDir.name);

        if (!extension) {
            // The URI doesn't have an extension, add it now.
            extension = CoreMimetypeUtils.instance.getExtension(result.mediaType);

            if (extension) {
                nameAndDir.name += '.' + extension;
            }
        }

        return decodeURIComponent(nameAndDir.name);
    }

    /**
     * Open the "file picker" to select and upload a file.
     *
     * @param maxSize Max size of the file to upload. If not defined or -1, no max size.
     * @param title File picker title.
     * @param mimetypes List of supported mimetypes. If undefined, all mimetypes supported.
     * @return Promise resolved when a file is uploaded, rejected if file picker is closed without a file uploaded.
     *         The resolve value is the response of the upload request.
     */
    selectAndUploadFile(maxSize?: number, title?: string, mimetypes?: string[]): Promise<any> {
        return this.selectFileWithPicker(maxSize, false, title, mimetypes, true);
    }

    /**
     * Open the "file picker" to select a file without uploading it.
     *
     * @param maxSize Max size of the file. If not defined or -1, no max size.
     * @param allowOffline True to allow selecting in offline, false to require connection.
     * @param title File picker title.
     * @param mimetypes List of supported mimetypes. If undefined, all mimetypes supported.
     * @return Promise resolved when a file is selected, rejected if file picker is closed without selecting a file.
     *         The resolve value is the FileEntry of a copy of the picked file, so it can be deleted afterwards.
     */
    selectFile(maxSize?: number, allowOffline?: boolean, title?: string, mimetypes?: string[])
            : Promise<any> {
        return this.selectFileWithPicker(maxSize, allowOffline, title, mimetypes, false);
    }

    /**
     * Open the "file picker" to select a file and maybe uploading it.
     *
     * @param maxSize Max size of the file. If not defined or -1, no max size.
     * @param allowOffline True to allow selecting in offline, false to require connection.
     * @param title File picker title.
     * @param mimetypes List of supported mimetypes. If undefined, all mimetypes supported.
     * @param upload Whether the file should be uploaded.
     * @return Promise resolved when a file is selected/uploaded, rejected if file picker is closed.
     */
    protected selectFileWithPicker(maxSize?: number, allowOffline?: boolean, title?: string, mimetypes?: string[],
            upload?: boolean): Promise<any> {
        // Create the cancel button and get the handlers to upload the file.
        const buttons: any[] = [{
                text: this.translate.instant('core.cancel'),
                role: 'cancel',
                handler: (): void => {
                    // User cancelled the action sheet.
                    this.filePickerClosed();
                }
            }],
            handlers = this.uploaderDelegate.getHandlers(mimetypes);

        this.filePickerDeferred = this.utils.promiseDefer();

        // Sort the handlers by priority.
        handlers.sort((a, b) => {
            return a.priority <= b.priority ? 1 : -1;
        });

        // Create a button for each handler.
        handlers.forEach((handler) => {
            buttons.push({
                text: this.translate.instant(handler.title),
                icon: handler.icon,
                cssClass: handler.class,
                handler: (): boolean => {
                    if (!handler.action) {
                        // Nothing to do.
                        return false;
                    }

                    if (!allowOffline && !this.appProvider.isOnline()) {
                        // Not allowed, show error.
                        this.domUtils.showErrorModal('core.fileuploader.errormustbeonlinetoupload', true);

                        return false;
                    }

                    handler.action(maxSize, upload, allowOffline, handler.mimetypes).then((data) => {
                        if (data.treated) {
                            // The handler already treated the file. Return the result.
                            return data.result;
                        } else {
                            // The handler didn't treat the file, we need to do it.
                            if (data.fileEntry) {
                                // The handler provided us a fileEntry, use it.
                                return this.uploadFileEntry(data.fileEntry, data.delete, maxSize, upload, allowOffline);
                            } else if (data.path) {
                                // The handler provided a path. First treat it like it's a relative path.
                                return this.fileProvider.getFile(data.path).catch(() => {
                                    // File not found, it's probably an absolute path.
                                    return this.fileProvider.getExternalFile(data.path);
                                }).then((fileEntry) => {
                                    // File found, treat it.
                                    return this.uploadFileEntry(fileEntry, data.delete, maxSize, upload, allowOffline);
                                });
                            }

                            // Nothing received, fail.
                            return Promise.reject('No file received');
                        }
                    }).then((result) => {
                        // Success uploading or picking, return the result.
                        this.fileUploaded(result);
                    }).catch((error) => {
                        this.domUtils.showErrorModalDefault(error, this.translate.instant('core.fileuploader.errorreadingfile'));
                    });

                    // Do not close the action sheet, it will be closed if success.
                    return false;
                }
            });
        });

        this.actionSheet = this.actionSheetCtrl.create({
            title: title ? title : this.translate.instant('core.fileuploader.' + (upload ? 'uploadafile' : 'selectafile')),
            buttons: buttons
        });
        this.actionSheet.present();

        // Call afterRender for each button.
        setTimeout(() => {
            handlers.forEach((handler) => {
                if (handler.afterRender) {
                    handler.afterRender(maxSize, upload, allowOffline, handler.mimetypes);
                }
            });
        }, 500);

        return this.filePickerDeferred.promise;
    }

    /**
     * Convenience function to upload a file on a certain site, showing a confirm if needed.
     *
     * @param fileEntry FileEntry of the file to upload.
     * @param deleteAfterUpload Whether the file should be deleted after upload.
     * @param siteId Id of the site to upload the file to. If not defined, use current site.
     * @return Promise resolved when the file is uploaded.
     */
    showConfirmAndUploadInSite(fileEntry: any, deleteAfterUpload?: boolean, siteId?: string): Promise<void> {
        return this.fileProvider.getFileObjectFromFileEntry(fileEntry).then((file) => {
            return this.confirmUploadFile(file.size).then(() => {
                return this.uploadGenericFile(fileEntry.toURL(), file.name, file.type, deleteAfterUpload, siteId).then(() => {
                    this.domUtils.showToast('core.fileuploader.fileuploaded', true, undefined, 'core-toast-success');
                });
            }).catch((err) => {
                if (err) {
                    this.domUtils.showErrorModal(err);
                }

                return Promise.reject(null);
            });
        }, () => {
            this.domUtils.showErrorModal('core.fileuploader.errorreadingfile', true);

            return Promise.reject(null);
        });
    }

    /**
     * Treat a capture audio/video error.
     *
     * @param error Error returned by the Cordova plugin. Can be a string or an object.
     * @param defaultMessage Key of the default message to show.
     * @return Rejected promise. If it doesn't have an error message it means it was cancelled.
     */
    protected treatCaptureError(error: any, defaultMessage: string): Promise<any> {
        // Cancelled or error. If cancelled, error is an object with code = 3.
        if (error) {
            if (typeof error === 'string') {
                this.logger.error('Error while recording audio/video: ' + error);
                if (error.indexOf('No Activity found') > -1) {
                    // User doesn't have an app to do this.
                    return Promise.reject(this.translate.instant('core.fileuploader.errornoapp'));
                } else {
                    return Promise.reject(this.translate.instant(defaultMessage));
                }
            } else {
                if (error.code != 3) {
                    // Error, not cancelled.
                    this.logger.error('Error while recording audio/video', error);

                    const message = error.code == 20 ? this.translate.instant('core.fileuploader.errornoapp') :
                            (error.message || this.translate.instant(defaultMessage));

                    return Promise.reject(message);
                } else {
                    return Promise.reject(this.domUtils.createCanceledError());
                }
            }
        }

        return Promise.reject(null);
    }

    /**
     * Treat a capture image or browse album error.
     *
     * @param error Error returned by the Cordova plugin.
     * @param defaultMessage Key of the default message to show.
     * @return Rejected promise. If it doesn't have an error message it means it was cancelled.
     */
    protected treatImageError(error: string, defaultMessage: string): Promise<any> {
        // Cancelled or error.
        if (error) {
            if (typeof error == 'string') {
                if (error.toLowerCase().indexOf('no image selected') > -1) {
                    // User cancelled.
                    return Promise.reject(this.domUtils.createCanceledError());
                }
            } else {
                return Promise.reject(this.translate.instant(defaultMessage));
            }
        }

        this.logger.error('Error getting image: ', error);

        return Promise.reject(error);
    }

    /**
     * Convenient helper for the user to record and upload a video.
     *
     * @param isAudio True if uploading an audio, false if it's a video.
     * @param maxSize Max size of the upload. -1 for no max size.
     * @param upload True if the file should be uploaded, false to return the picked file.
     * @param mimetypes List of supported mimetypes. If undefined, all mimetypes supported.
     * @return Promise resolved when done.
     */
    uploadAudioOrVideo(isAudio: boolean, maxSize: number, upload?: boolean, mimetypes?: string[]): Promise<any> {
        this.logger.debug('Trying to record a ' + (isAudio ? 'audio' : 'video') + ' file');

        const options = { limit: 1, mimetypes: mimetypes },
            promise = isAudio ? this.fileUploaderProvider.captureAudio(options) : this.fileUploaderProvider.captureVideo(options);

        // The mimetypes param is only for desktop apps, the Cordova plugin doesn't support it.
        return promise.then((medias) => {
            // We used limit 1, we only want 1 media.
            const media: MediaFile = medias[0];
            let path = media.fullPath;
            const error = this.fileUploaderProvider.isInvalidMimetype(mimetypes, path); // Verify that the mimetype is supported.

            if (error) {
                return Promise.reject(error);
            }

            // Make sure the path has the protocol. In iOS it doesn't.
            if (this.appProvider.isMobile() && path.indexOf('file://') == -1) {
                path = 'file://' + path;
            }

            const options = this.fileUploaderProvider.getMediaUploadOptions(media);

            if (upload) {
                return this.uploadFile(path, maxSize, true, options);
            } else {
                // Copy or move the file to our temporary folder.
                return this.copyToTmpFolder(path, true, maxSize, undefined, options);
            }
        }, (error) => {
            const defaultError = isAudio ? 'core.fileuploader.errorcapturingaudio' : 'core.fileuploader.errorcapturingvideo';

            return this.treatCaptureError(error, defaultError);
        });
    }

    /**
     * Uploads a file of any type.
     * This function will not check the size of the file, please check it before calling this function.
     *
     * @param uri File URI.
     * @param name File name.
     * @param type File type.
     * @param deleteAfterUpload Whether the file should be deleted after upload.
     * @param siteId Id of the site to upload the file to. If not defined, use current site.
     * @return Promise resolved when the file is uploaded.
     */
    uploadGenericFile(uri: string, name: string, type: string, deleteAfterUpload?: boolean, siteId?: string): Promise<any> {
        const options = this.fileUploaderProvider.getFileUploadOptions(uri, name, type, deleteAfterUpload);

        return this.uploadFile(uri, -1, false, options, siteId);
    }

    /**
     * Convenient helper for the user to upload an image, either from the album or taking it with the camera.
     *
     * @param fromAlbum True if the image should be selected from album, false if it should be taken with camera.
     * @param maxSize Max size of the upload. -1 for no max size.
     * @param upload True if the file should be uploaded, false to return the picked file.
     * @param mimetypes List of supported mimetypes. If undefined, all mimetypes supported.
     * @return Promise resolved when done.
     */
    uploadImage(fromAlbum: boolean, maxSize: number, upload?: boolean, mimetypes?: string[]): Promise<any> {
        this.logger.debug('Trying to capture an image with camera');

        const options: CameraOptions = {
            quality: 50,
            destinationType: this.camera.DestinationType.FILE_URI,
            correctOrientation: true
        };

        if (fromAlbum) {
            const imageSupported = !mimetypes || this.utils.indexOfRegexp(mimetypes, /^image\//) > -1,
                videoSupported = !mimetypes || this.utils.indexOfRegexp(mimetypes, /^video\//) > -1;

            options.sourceType = this.camera.PictureSourceType.PHOTOLIBRARY;
            options.popoverOptions = {
                x: 10,
                y: 10,
                width: this.platform.width() - 200,
                height: this.platform.height() - 200,
                arrowDir: this.camera.PopoverArrowDirection.ARROW_ANY
            };

            // Determine the mediaType based on the mimetypes.
            if (imageSupported && !videoSupported) {
                options.mediaType = this.camera.MediaType.PICTURE;
            } else if (!imageSupported && videoSupported) {
                options.mediaType = this.camera.MediaType.VIDEO;
            } else if (this.platform.is('ios')) {
                // Only get all media in iOS because in Android using this option allows uploading any kind of file.
                options.mediaType = this.camera.MediaType.ALLMEDIA;
            }
        } else if (mimetypes) {
            if (mimetypes.indexOf('image/jpeg') > -1) {
                options.encodingType = this.camera.EncodingType.JPEG;
            } else if (mimetypes.indexOf('image/png') > -1) {
                options.encodingType = this.camera.EncodingType.PNG;
            }
        }

        return this.fileUploaderProvider.getPicture(options).then((path) => {
            const error = this.fileUploaderProvider.isInvalidMimetype(mimetypes, path); // Verify that the mimetype is supported.
            if (error) {
                return Promise.reject(error);
            }

            const options = this.fileUploaderProvider.getCameraUploadOptions(path, fromAlbum);

            if (upload) {
                return this.uploadFile(path, maxSize, true, options);
            } else {
                // Copy or move the file to our temporary folder.
                return this.copyToTmpFolder(path, !fromAlbum, maxSize, 'jpg', options);
            }
        }, (error) => {
            const defaultError = fromAlbum ? 'core.fileuploader.errorgettingimagealbum' : 'core.fileuploader.errorcapturingimage';

            return this.treatImageError(error, defaultError);
        });
    }

    /**
     * Upload a file given the file entry.
     *
     * @param fileEntry The file entry.
     * @param deleteAfter True if the file should be deleted once treated.
     * @param maxSize Max size of the file. If not defined or -1, no max size.
     * @param upload True if the file should be uploaded, false to return the picked file.
     * @param allowOffline True to allow selecting in offline, false to require connection.
     * @param name Name to use when uploading the file. If not defined, use the file's name.
     * @return Promise resolved when done.
     */
    uploadFileEntry(fileEntry: any, deleteAfter: boolean, maxSize?: number, upload?: boolean, allowOffline?: boolean,
            name?: string): Promise<any> {
        return this.fileProvider.getFileObjectFromFileEntry(fileEntry).then((file) => {
            return this.uploadFileObject(file, maxSize, upload, allowOffline, name).then((result) => {
                if (deleteAfter) {
                    // We have uploaded and deleted a copy of the file. Now delete the original one.
                    this.fileProvider.removeFileByFileEntry(fileEntry);
                }

                return result;
            });
        });
    }

    /**
     * Upload a file given the file object.
     *
     * @param file The file object.
     * @param maxSize Max size of the file. If not defined or -1, no max size.
     * @param upload True if the file should be uploaded, false to return the picked file.
     * @param allowOffline True to allow selecting in offline, false to require connection.
     * @param name Name to use when uploading the file. If not defined, use the file's name.
     * @return Promise resolved when done.
     */
    async uploadFileObject(file: any, maxSize?: number, upload?: boolean, allowOffline?: boolean, name?: string): Promise<any> {
        if (maxSize != -1 && file.size > maxSize) {
            return this.errorMaxBytes(maxSize, file.name);
        }

        if (upload) {
            await this.confirmUploadFile(file.size, false, allowOffline);
        }

        // We have the data of the file to be uploaded, but not its URL (needed). Create a copy of the file to upload it.
        return this.copyAndUploadFile(file, upload, name);
    }

    /**
     * Convenience function to upload a file, allowing to retry if it fails.
     *
     * @param path Absolute path of the file to upload.
     * @param maxSize Max size of the upload. -1 for no max size.
     * @param checkSize True to check size.
     * @param Options.
     * @param siteId Site ID. If not defined, current site.
     * @return Promise resolved if the file is uploaded, rejected otherwise.
     */
    uploadFile(path: string, maxSize: number, checkSize: boolean, options: CoreFileUploaderOptions, siteId?: string)
            : Promise<any> {

        const errorStr = this.translate.instant('core.error'),
            retryStr = this.translate.instant('core.retry'),
            uploadingStr = this.translate.instant('core.fileuploader.uploading'),
            errorUploading = (error): Promise<any> => {
                // Allow the user to retry.
                return this.domUtils.showConfirm(error, errorStr, retryStr).then(() => {
                    // Try again.
                    return this.uploadFile(path, maxSize, checkSize, options, siteId);
                }, () => {
                    // User cancelled. Delete the file if needed.
                    if (options.deleteAfterUpload) {
                        this.fileProvider.removeExternalFile(path);
                    }

                    return Promise.reject(this.domUtils.createCanceledError());
                });
            };

        let promise,
            file;

        if (!this.appProvider.isOnline()) {
            return errorUploading(this.translate.instant('core.fileuploader.errormustbeonlinetoupload'));
        }

        if (checkSize) {
            // Check that file size is the right one.
            promise = this.fileProvider.getExternalFile(path).then((fileEntry) => {
                return this.fileProvider.getFileObjectFromFileEntry(fileEntry).then((f) => {
                    file = f;

                    return file.size;
                });
            }).catch(() => {
                // Ignore failures.
            });
        } else {
            promise = Promise.resolve(0);
        }

        return promise.then((size) => {
            if (maxSize != -1 && size > maxSize) {
                return this.errorMaxBytes(maxSize, file.name);
            }

            if (size > 0) {
                return this.confirmUploadFile(size);
            }
        }).then(() => {
            // File isn't too large and user confirmed, let's upload.
            const modal = this.domUtils.showModalLoading(uploadingStr);

            return this.fileUploaderProvider.uploadFile(path, options, (progress: ProgressEvent) => {
                // Progress uploading.
                this.showProgressModal(modal, 'core.fileuploader.uploadingperc', progress);
            }, siteId).catch((error) => {
                this.logger.error('Error uploading file.', error);

                modal.dismiss();
                if (typeof error != 'string') {
                    error = this.translate.instant('core.fileuploader.errorwhileuploading');
                }

                return errorUploading(error);
            }).finally(() => {
                modal.dismiss();
            });
        });
    }

    /**
     * Show a progress modal.
     *
     * @param modal The modal where to show the progress.
     * @param stringKey The key of the string to display.
     * @param progress The progress event.
     */
    protected showProgressModal(modal: Loading, stringKey: string, progress: ProgressEvent | CoreFileProgressEvent): void {
        if (progress && progress.lengthComputable) {
            // Calculate the progress percentage.
            const perc = Math.min((progress.loaded / progress.total) * 100, 100);

            if (perc >= 0) {
                modal.setContent(this.translate.instant(stringKey, { $a: perc.toFixed(1) }));

                if (modal._cmp && modal._cmp.changeDetectorRef) {
                    // Force a change detection, otherwise the content is not updated.
                    modal._cmp.changeDetectorRef.detectChanges();
                }
            }
        }
    }
}
