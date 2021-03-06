// The MIT License (MIT)
//
// Copyright (c) Marcel Joachim Kloubert <marcel.kloubert@gmx.net>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

import { ios } from "tns-core-modules/application/application";
import { IInitializationResult, ILoginResult, LoginResultType, Social, LOGTAG_LOGIN_WITH_GOOGLE } from "./SocialLogin-common";

declare const FBSDKGraphRequest, FBSDKLoginManager, GIDSignIn, GIDSignInDelegate, GIDSignInUIDelegate;

const LOGTAG_FB_LOGIN_MGR = "facebookLoginManager";
const LOGTAG_ON_GOOGLE_RESULT = "Google successCallback";

export class SocialLogin extends Social {
	private _facebookCallbackManager;
	private facebookLoginManager;

	private _googleProfileInfoCallback;
	private googleFailCallback;
	private googleSignIn = null;
	private googleCancelCallback;
	private googleSuccessCallback;

	public init(result: IInitializationResult): IInitializationResult {
		if (this.Config.facebook) {
			this.facebookLoginManager = FBSDKLoginManager.alloc().init();

			if (this.facebookLoginManager) {
				if (this.Config.facebook.clearSession) {
					this.facebookLoginManager.logOut();
				}
				if (this.Config.facebook.loginBehavior) {
					this.facebookLoginManager.loginBehavior = this.Config.facebook.loginBehavior;
				}
				result.facebook.isInitialized = true;
			}

		}

		if (this.Config.google) {
			this.googleSignIn = GIDSignIn.sharedInstance();
			this.googleSignIn.shouldFetchBasicProfile = this.Config.google.shouldFetchBasicProfile;
			this.googleSignIn.scopes = this.Config.google.scopes;

			// Setting 'googleSignIn.serverClientID' forces retrieval of an offline auth code in iOS.
			// Set it only if that's what the user is expecting to retrieve.
			if (this.Config.google.serverClientId && this.Config.google.isRequestAuthCode) {
				this.googleSignIn.serverClientID = this.Config.google.serverClientId;
			}

			result.google.isInitialized = true;
		}

		return result;
	}

	public loginWithFacebook(callback: (result: Partial<ILoginResult>) => void) {
		const invokeLoginCallbackForFacebook = resultCtx => {
			resultCtx.provider = "facebook";

			this.logResult(resultCtx, LOGTAG_FB_LOGIN_MGR);

			// tslint:disable-next-line:no-unused-expression
			callback && callback(resultCtx);
		};

		const failCallback = error => {
			this.logMsg("onError()", LOGTAG_FB_LOGIN_MGR);

			invokeLoginCallbackForFacebook({
				code: LoginResultType.Failed,
				error: error,
			});
		};

		const cancelCallback = () => {
			this.logMsg("onCancel()", LOGTAG_FB_LOGIN_MGR);

			invokeLoginCallbackForFacebook({
				code: LoginResultType.Cancelled,
			});
		};

		const successCallback = result => {
			let authToken;
			this.logMsg("onSuccess().onCompleted()", LOGTAG_FB_LOGIN_MGR);

			const resultFn = (connection, theResult, handler) => {
				let code = LoginResultType.Success;
				let err;
				let usrToken;
				let displayName;
				let firstName;
				let lastName;
				let photo;
				let id;

				try {
					// ID
					id = theResult.objectForKey("id");
					// email
					usrToken = theResult.objectForKey("email");

					// name
					displayName = theResult.objectForKey("name");

					if (theResult.objectForKey("first_name")) {
						firstName = theResult.objectForKey("first_name");
					}

					if (theResult.objectForKey("last_name")) {
						lastName = theResult.objectForKey("last_name");
					}

					// photo
					if (
						theResult.objectForKey("picture") &&
						theResult.objectForKey("picture").objectForKey("data") &&
						theResult.objectForKey("picture").objectForKey("data").objectForKey("url")
					) {
						photo = theResult.objectForKey("picture").objectForKey("data").objectForKey("url");
					}

				} catch (e) {
					this.logMsg("[ERROR] onSuccess().onCompleted(): " + e, LOGTAG_FB_LOGIN_MGR);

					code = LoginResultType.Exception;
					err = e;
				}
				if (code !== LoginResultType.Exception) {
					invokeLoginCallbackForFacebook({
						authToken: authToken,
						code: code,
						displayName: displayName,
						firstName: firstName,
						lastName: lastName,
						error: err,
						id: id,
						photo: photo,
						userToken: usrToken,
					});
				} else {
					invokeLoginCallbackForFacebook({
						code: code,
						error: err,
					});
				}
			};

			authToken = result.token.tokenString;
			const fbRequest = FBSDKGraphRequest.alloc();
			fbRequest.initWithGraphPathParametersTokenStringVersionHTTPMethod(
				"me",
				{ "fields": "id,about,birthday,email,gender,name,first_name,last_name,picture" },
				authToken,
				null,
				"GET"
			).startWithCompletionHandler(resultFn);
		};

		if (!!callback) {
			this._facebookCallbackManager = (result, error) => {
				if (error) {
					failCallback(error);
					return;
				}
				if (!result) {
					failCallback("Null error");
					return;
				}
				if (result.isCancelled) {
					cancelCallback();
					return;
				}
				if (result.token) {
					successCallback(result);
				} else {
					failCallback("Could not acquire an access token");
					return;
				}
			};
		}

		const permissions = ["public_profile", "email"];

		// this.facebookLoginManager.logInWithPublishPermissionsHandler(permissions, this._facebookCallbackManager);
		this.facebookLoginManager.logInWithReadPermissionsHandler(permissions, this._facebookCallbackManager);
	}

	private createSignInDelegate() {
		const self = this;
		class MySignInDelegate extends NSObject {
			static ObjCProtocols = [GIDSignInDelegate, GIDSignInUIDelegate];

			constructor() {
				super();
			}

			signInDidSignInForUserWithError(signIn, user, error) {
				if (error) {
					self.googleFailCallback(error);
				} else {

					try {
						const resultUser = {
							userToken: user.profile.email,
							firstName: user.profile.givenName,
							lastName: user.profile.familyName,
							displayName: user.profile.name,
							authCode: user.serverAuthCode ? user.serverAuthCode : user.authentication.idToken,  // Safe to send to the server
							id: user.userID, // For client-side use only!
						};

						self.googleSuccessCallback(resultUser);

						if (!self._googleProfileInfoCallback) {
							self.logMsg("no callback set", LOGTAG_ON_GOOGLE_RESULT);
						}
					} catch (error) {
						self.googleFailCallback(error);
					}

				}
			}

			signInDidDisconnectWithUserWithError(signIn, user, error) {
				try {
					if (error) {
						self.googleFailCallback(error.localizedDescription);
					} else {
						// googleSuccessCallback("logOut");
						self.googleCancelCallback();
					}
				} catch (error) {
					self.googleFailCallback(error);
				}
			}

			// signInWillDispatchError(signIn, error) {
			// }

			signInPresentViewController(signIn, viewController) {
				const uiview = ios.rootController;
				uiview.presentViewControllerAnimatedCompletion(viewController, true, null);
			}

			signInDismissViewController(signIn, viewController) {
				viewController.dismissViewControllerAnimatedCompletion(true, null);
			}
		}

		return new MySignInDelegate();
	}

	public loginWithGoogle(callback: (result: Partial<ILoginResult>) => void) {

		const invokeLoginCallbackForGoogle = resultCtx => {
			resultCtx.provider = "google";

			this.logResult(resultCtx, LOGTAG_LOGIN_WITH_GOOGLE);

			// tslint:disable-next-line:no-unused-expression
			callback && callback(resultCtx);
		};

		this.googleFailCallback = error => {
			this.logMsg("onError()", LOGTAG_LOGIN_WITH_GOOGLE);

			invokeLoginCallbackForGoogle({
				code: LoginResultType.Failed,
				error: error,
			});
		};

		this.googleCancelCallback = () => {
			this.logMsg("onCancel()", LOGTAG_LOGIN_WITH_GOOGLE);

			invokeLoginCallbackForGoogle({
				code: LoginResultType.Cancelled,
			});
		};

		this.googleSuccessCallback = result => {
			this.logMsg("onSuccess().onCompleted()", LOGTAG_LOGIN_WITH_GOOGLE);

			invokeLoginCallbackForGoogle({
				authCode: result.authCode,
				code: LoginResultType.Success,
				displayName: result.displayName,
				error: result.error,
				id: result.id,
				userToken: result.userToken,
			});
		};

		if (!!callback) {
			this._googleProfileInfoCallback = callback;

			const delegate = this.createSignInDelegate();
			if (!this.googleSignIn.delegate) {
				this.googleSignIn.delegate = delegate;
			}
			if (!this.googleSignIn.uiDelegate) {
				this.googleSignIn.uiDelegate = delegate;
			}

			this.googleSignIn.signIn();
		}
	}

	public loginWithTwitter(callback: (result: Partial<ILoginResult>) => void) { }
}

