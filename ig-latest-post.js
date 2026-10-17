// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: yellow; icon-glyph: camera-retro;
/* -----------------------------------------------
Script      : ig-latest-post.js
Author      : me@supermamon.com
Version     : 2.0.2
Description :
  Displays the latest instagram post of a selected
  user or users. Tap the widget to open the 
  Instagram post in the app
Changelog:
v2.0.2 - Add login status setting
v2.0.1 - Fixed 'TypeError: null is not an object (evaluating 'req.response.cookies.forEach')'
v2.0.0 - Fixed 'format' error
       - Now works with private users 
       - Now works in restricted regions
v1.3.0 - Pick the highest resolution photo
v1.2.0 - Option to pick up to 12 of the most 
         recent posts
v1.1.0 - Options to show likes and comments count
v1.0.0 - Initial release
----------------------------------------------- */
const VERSION = '2.2.0';

const DEBUG = false;
const log = (args) => {

    if (DEBUG) {
        console.log(args);
    }
};

const WIDGET_FAMILY = Device.isPad() ? ['Small', 'Medium', 'Large', 'ExtraLarge'] : ['Small', 'Medium', 'Large'];
const LARGE_WIDGET_FAMILY = ['large', 'extraLarge'];

const ARGUMENTS = {
    appId: '936619743392459',
    // PolarisProfilePostsTabContentQuery_connection.
    // Instagram may rotate this id on deploy.
    profilePostsDocId: '28858033960505345',
    isNeedLogin: true,
    // desired interval in minutes to refresh the
    // widget. This will only tell IOS that it's
    // ready for a refresh, whether it actually 
    // refreshes is up to IOS
    refreshInterval: 5, //mins
    // pick up to 12 of the most recent posts and
    // select randomly between those. 
    maxRecentPosts: 12,
    // stuff to display at the bottom of the widget
    showUserName: true,
    showLikes: true,
    showComments: true,
    // only show the staus line is any of the
    // status items are visible
    showStatusLine: function () {
        return this.showUserName || this.showLikes || this.showComments;
    },
    // The script randomly chooses from this list of
    // users. If a list if users is passed as a 
    // parameter on the widget configuration screen,
    // it uses those instead. The list of users in the 
    // configuration screen must be comma-separated
    users: [
        'beautifuldestinations',
        'natgeotravel',
        'igersmanila',
        'cntraveler',
        'the_philippines',
        'nasachandraxray'
    ]
};
Object.seal(ARGUMENTS);

// DO NOT EDIT BEYOND THIS LINE ------------------

const MENU_PROPERTY = {
    rowDismiss: true,
    rowHeight: 50,
    subtitleColor: Color.lightGray()
};
Object.freeze(MENU_PROPERTY);

const CommonUtil = {
    isNumber: function (value) {
        let isValid = false;
    
        if (typeof value === 'number') {
            isValid = true;
        } else if (typeof value === 'string') {
            isValid = /^\d{1,}$/.test(value);
        }
    
        return isValid;
    },
    compareVersion: function (version1 = '', version2 = '') {
        const v1 = version1.trim().split('.');
        const v2 = version2.trim().split('.');

        if (![...v1, ...v2].every(v => this.isNumber(v))) {
            return false;
        }

        // compare each segment numerically so that 2.1.4 < 2.1.10
        for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const diff = Number(v1[i] || 0) - Number(v2[i] || 0);

            if (diff !== 0) {
                return diff < 0;
            }
        }

        return false;
    },
    isLargeFamily: function (widgetFamily) {
        widgetFamily = widgetFamily || config.widgetFamily;
    
        return LARGE_WIDGET_FAMILY.includes(widgetFamily);
    }
};

const isOnline = async () => {
    const webView = new WebView();
    await webView.loadURL('about:blank');
    
    log(await webView.evaluateJavaScript('navigator.onLine'));
    
    return await webView.evaluateJavaScript('navigator.onLine');
};

// InstagramClient module ------------------------
// const InstagramClient = importModule('InstagramClient')
// EMBED 
const InstagramClient = {
    //----------------------------------------------
    initialize: function () {
        this.USES_ICLOUD = module.filename.includes('Documents/iCloud~');
        this.fm = this.USES_ICLOUD ? FileManager.iCloud() : FileManager.local();
        this.root = this.fm.joinPath(this.fm.documentsDirectory(), '/cache/igclient');
        this.imageRoot = this.fm.joinPath(this.root, '/images');
        this.fm.createDirectory(this.root, true);
        this.fm.createDirectory(this.imageRoot, true)

        if (ARGUMENTS.isNeedLogin) {
            // track the number of login attempts
            // so we don't get an infinite login screen
            this.loginAttempts = 0;
            this.MAX_ATTEMPTS = 2;

            this.sessionPath = this.fm.joinPath(this.root, 'session.json');
            this.sessionid = '';
        }
    },
    //----------------------------------------------
    authenticate: async function () {

        if (!config.runsInWidget && ARGUMENTS.isNeedLogin) {
            const url = 'https://instagram.com/';
            const req = new Request(url);
            const result = {};

            await req.load();

            if (req.response.cookies && Array.isArray(req.response.cookies)) {
                req.response.cookies.forEach(cookie => {

                    if (cookie.name === 'sessionid') {
                        result.sessionid = cookie.value;
                        result.expiresDate = cookie.expiresDate;
                        result.cookies = req.response.cookies;
                        return;
                    }
                });
            }

            if (!result.sessionid) {

                if (this.loginAttempts < this.MAX_ATTEMPTS) {
                    this.loginAttempts++;
                    const resp = await this.presentAlert('You will now be presented with the Instagram login window.\nAuthentication happens on the Instagram website and your credentials will neither be captured nor stored.', ['Proceed', 'Cancel']);

                    if (resp === 1) {
                        this.loginAttempts = this.MAX_ATTEMPTS;
                        throw new Error('login was cancelled');
                    }

                    const webview = new WebView();

                    await webview.loadURL(url);
                    await webview.present(false);

                    return await this.authenticate();
                } else {
                    throw new Error('Maximum number of login attempts reached. Please launch the script again.');
                }
            } else {
                result.cookies = req.response.cookies;

                await this.saveSession(result);

                this.sessionid = result.sessionid;

                return result;
            }
        }

        return undefined;
    },
    //----------------------------------------------
    logout: async function () {
        log(`session exists - ${this.fm.fileExists(this.sessionPath)}`);

        if (this.fm.fileExists(this.sessionPath)) {
            log('deleting session file');

            await this.fm.remove(this.sessionPath);
        }

        log('logging out');

        const webview = new WebView();
        await webview.loadURL('https://www.instagram.com/accounts/logout');
        //await webview.present(false);
    },
    //----------------------------------------------
    startSession: async function () {

        if (ARGUMENTS.isNeedLogin) {
            let sessionCache = await this.readSession();

            if (sessionCache) {
                log(`cached sessionid ${sessionCache.sessionid}`);
                log(`session expires on ${new Date(sessionCache.expiresDate)}`);

                if (new Date() >= new Date(sessionCache.expiresDate)) {
                    log('delete session cache');

                    sessionCache = undefined;
                    InstagramClient.removeSession();
                }
            }

            if (!sessionCache) {
                log('refreshing session cache');

                // authenticate() also sets this.sessionid
                sessionCache = await this.authenticate();
            }

            if (!sessionCache) {
                throw new Error('Instagram session not found. Please launch the script in the app to log in.');
            }

            return this;
        }
    },
    //----------------------------------------------
    fetchGraphQL: async function (docId, variables) {
        log(`fetching graphql ${docId}`);

        const cookies = await this.getCookies();
        const csrf = (cookies.match(/csrftoken=([^;]+)/) || [])[1] || '';

        const req = new Request('https://www.instagram.com/graphql/query');
        req.method = 'POST';
        req.headers = {
            'X-IG-App-ID': ARGUMENTS.appId,
            'X-CSRFToken': csrf,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: 'https://www.instagram.com/',
            Cookie: cookies
        };
        req.body = `doc_id=${docId}&variables=${encodeURIComponent(JSON.stringify(variables))}`;

        const response = await req.loadJSON();

        log(response);

        return response;
    },
    //----------------------------------------------
    getUserInfo: async function (username) {
        const count = Number(ARGUMENTS.maxRecentPosts);
        const response = await this.fetchGraphQL(ARGUMENTS.profilePostsDocId, {
            after: null,
            before: null,
            first: count,
            last: null,
            username: username,
            data: {
                count: count,
                include_reel_media_seen_timestamp: true,
                include_relationship_info: true,
                latest_besties_reel_media: true,
                latest_reel_media: true
            },
            include_multi_captions: false,
            __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
            __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
            __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
            __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false
        });
        const edges = response?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges || [];

        if (edges.length === 0) {
            throw new Error(`Invalid user - ${username}`);
        }

        // keep the legacy REST shape so getLatestPost() works unchanged
        return { items: edges.map(edge => edge.node) };
    },
    //----------------------------------------------
    readSession: async function () {

        if (ARGUMENTS.isNeedLogin) {
            log('reading session');

            if (this.fm.fileExists(this.sessionPath)) {
                log(`file found`);

                if (this.USES_ICLOUD) {
                    await this.fm.downloadFileFromiCloud(this.sessionPath);
                }

                log(`reading session file`);

                const result = await this.fm.read(this.sessionPath);

                if (!result || !result.toRawString()) {
                    log(`error reading file`);

                    return undefined;
                } else {
                    const session = JSON.parse(result.toRawString());

                    log(session);

                    return session;
                }
            }
        }

        return undefined;
    },
    //----------------------------------------------
    saveSession: async function (json) {

        if (ARGUMENTS.isNeedLogin) {

            if (this.fm.fileExists(this.sessionPath)) {
                await this.fm.remove(this.sessionPath);
            }

            await this.fm.writeString(this.sessionPath, JSON.stringify(json));
        }
    },
    removeSession: async function () {
        if (this.fm.fileExists(this.sessionPath)) {
            this.fm.remove(this.sessionPath);
        }
    },
    saveImage: async function (image, imageUrl) {
        const regex = /(\d{1,}_\d{1,}_\d{1,}_n)/gi;
        this.fm.writeImage(this.fm.joinPath(this.imageRoot, `${regex.exec(imageUrl).shift()}.jpg`), image);
    },
    readImage: async function () {
        const files = this.fm.listContents(this.imageRoot);
       
        if (files.length > 0) {
            const filePath = this.fm.joinPath(this.imageRoot, getRandom(files));
            await this.fm.downloadFileFromiCloud(filePath);
            return this.fm.readImage(filePath);
        } else {
            throw new Error("Not Found Image");
        }
    },
    getCookies: async function () {

        if (ARGUMENTS.isNeedLogin) {
            const session = await this.readSession();

            if (!session?.cookies) {
                throw new Error('Instagram session not found. Please launch the script in the app to log in.');
            }

            const cookies = session.cookies.map(cookie => {
                log(`adding cookie ${cookie.name}`)

                return `${cookie.name}=${cookie.value}`;
            }).join(';');

            log(`returning cookies = ${cookies}`);

            return cookies;
        }

        return '';
    },
    clearCache: async function () {
        this.fm.remove(this.root);
    },
    updateModule: async function () {
        try {
            const latestVersion = await new Request('https://raw.githubusercontent.com/clauzewitz/scriptable-instagram-widgets/master/version').loadString();

            if (CommonUtil.compareVersion(VERSION, latestVersion)) {
                const code = await new Request('https://raw.githubusercontent.com/clauzewitz/scriptable-instagram-widgets/master/ig-latest-post.js').loadString();
                this.fm.writeString(this.fm.joinPath(this.fm.documentsDirectory(), `${Script.name()}.js`), code);
                await this.presentAlert(`Update to version ${latestVersion}\nPlease launch the app again.`);
            } else {
                await this.presentAlert(`version ${VERSION} is currently the newest version available.`);
            }
        } catch (e) {
            log(e.message);
        }
    },
    //----------------------------------------------
    presentAlert: async function (prompt = '', items = ['OK'], asSheet = false) {
        try {
            const alert = new Alert();
            alert.message = prompt;
    
            items.forEach(item => {
                alert.addAction(item);
            });
    
            return asSheet ? await alert.presentSheet() : await alert.presentAlert();
        } catch (e) {
            log(e.message);
        }
    }
};
// InstagramClient module ends -------------------

//------------------------------------------------
const getLatestPost = async (username) => {
    let user = undefined;

    try {
        user = await InstagramClient.getUserInfo(username);
    } catch (e) {
        log(`error encountered - ${e.message}`);

        return {
            has_error: true,
            message: e.message
        };
    }

    if (!user || !user.items) {
        return {
            has_error: true,
            message: `not exists user\n${username}`
        };
    }

    let idx = Math.floor(Math.random() * user.items.length);
    let item = user.items[idx];
    let mediaInfo = item.carousel_media?.[Math.floor(Math.random() * item.carousel_media?.length)]?.image_versions2 || item.image_versions2

    return {
        has_error: false,
        username: username,
        shortcode: item.pk,
        display_url: mediaInfo.candidates.sort((a, b) => b.width - a.width).shift().url,
        is_video: item.media_type == 2,
        comments: item.comment_count,
        likes: item.like_count
    };
};

//------------------------------------------------
const createTempWidget = async () => {
    const padding = getPaddingSize();
    
    const widget = new ListWidget();
    widget.setPadding(padding, padding, padding, padding);
    widget.backgroundImage = await InstagramClient.readImage();
    widget.backgroundGradient = newLinearGradient(['#00000088', '#ffffff00', '#ffffff00'], [1, 0.75, 0]);

    const stack = createStack(widget);

    addSymbol(stack, 'wifi.exclamationmark', getFontSize());

    stack.addSpacer();
    widget.addSpacer();

    return widget;
};

//------------------------------------------------
const createErrorWidget = async (data) => {
    
    try {
        return await createTempWidget();
    } catch (e) {
        const widget = new ListWidget();
        widget.addSpacer();

        log(data.message);

        const text = widget.addText(data.message);
        text.textColor = Color.white();
        text.centerAlignText();

        return widget;
    }
};

//------------------------------------------------
const createWidget = async (data, widgetFamily) => {

    if (data.has_error) {
        return await createErrorWidget(data);
    }

    const padding = getPaddingSize(widgetFamily);
    const fontSize = getFontSize(widgetFamily);
    const img = await download('Image', data.display_url);
   
    InstagramClient.saveImage(img, data.display_url);
    
    const widget = new ListWidget();
    widget.refreshAfterDate = new Date((Date.now() + (1000 * 60 * ARGUMENTS.refreshInterval)));
//    widget.url = `https://www.instagram.com/p/${data.shortcode}`;
    widget.url = data.display_url;
    widget.setPadding(padding, padding, padding, padding);
    widget.backgroundImage = img;

    if (ARGUMENTS.showStatusLine()) {
        // add gradient with a semi-transparent 
        // dark section at the bottom. this helps
        // with the readability of the status line
        widget.backgroundGradient = newLinearGradient(['#ffffff00','#ffffff00','#00000088'], [0, 0.75, 1]);

        // top spacer to push the bottom stack down
        widget.addSpacer();

        const stats = createStack(widget);

        if (ARGUMENTS.showUserName) {
            addText(stats, `@${data.username}`,'left', fontSize);
        }

        // center spacer to push items to the sides
        stats.addSpacer();

        if (ARGUMENTS.showLikes) {
            addSymbol(stats, 'heart.fill', fontSize);
            addText(stats, abbreviateNumber(data.likes), 'right', fontSize);
        }

        if (ARGUMENTS.showComments) {
            addSymbol(stats, 'message.fill', fontSize);
            addText(stats, abbreviateNumber(data.comments), 'right', fontSize);
        }
    }

    return widget;
};

//------------------------------------------------
const addSymbol = (container, name, size) => {
    const icon = container.addImage(SFSymbol.named(name).image);
    icon.tintColor = Color.white();
    icon.imageSize = new Size(size,size);

    return icon;
};

//------------------------------------------------
const addText = (container, text, align, size) => {
    const txt = container.addText(text);
    txt[`${align}AlignText`]();
    txt.font = Font.systemFont(size);
    txt.shadowRadius = 3;
    txt.textColor = Color.white();
    txt.shadowColor = Color.black();
};

//------------------------------------------------
const getRandom = (array) => {
    return array[~~(Math.random() * array.length)];
};

//------------------------------------------------
const newLinearGradient = (hexcolors, locations) => {
    const gradient = new LinearGradient();
    gradient.locations = locations;
    gradient.colors = hexcolors.map(color => new Color(color));

    return gradient;
};

//------------------------------------------------
const createStack = (widget) => {
    // horizontal stack to hold the status line
    const stack = widget.addStack();
    stack.layoutHorizontally();
    stack.centerAlignContent();
    stack.spacing = 3;

    return stack;
};

//------------------------------------------------
const download = async (dType, url) => {
    const req = new Request(url);

    return await req[`load${dType}`](url);
};

//------------------------------------------------
const getPaddingSize = (widgetFamily) => {
    return CommonUtil.isLargeFamily(widgetFamily) ? 12 : 10;
};

//------------------------------------------------
const getFontSize = (widgetFamily) => {
    return CommonUtil.isLargeFamily(widgetFamily) ? 14 : 10;
};

//------------------------------------------------
const createLatestPostWidget = async (username, widgetFamily) => {

    if (await isOnline()) {
        return await createWidget(await getLatestPost(username), widgetFamily);
    }

    return await createTempWidget();
}

const checkWidgetParameter = () => {

    if (args.widgetParameter) {
        const aWidgetParameter = args.widgetParameter.split(/\s*\|\s*/);

        switch (aWidgetParameter.length) {
            case 4:
                const showColumns = aWidgetParameter[3].split(/\s*,\s*/);

                showColumns.forEach((column, index) => {
                    let key = undefined;

                    switch (index) {
                        case 2:
                            key = 'showComments';
                            break;
                        case 1:
                            key = 'showLikes';
                            break;
                        default:
                            key = 'showUserName';
                            break;
                    }

                    if (!!key) {
                        ARGUMENTS[key] = (column === 'true');
                    }
                });
            case 3:
                const maxRecentPosts = aWidgetParameter[2] || ARGUMENTS.maxRecentPosts;
                ARGUMENTS.maxRecentPosts = CommonUtil.isNumber(maxRecentPosts) ? maxRecentPosts : ARGUMENTS.maxRecentPosts;
            case 2:
                const refreshInterval = aWidgetParameter[1] || ARGUMENTS.refreshInterval;
                ARGUMENTS.refreshInterval = CommonUtil.isNumber(refreshInterval) ? refreshInterval : ARGUMENTS.refreshInterval;
            case 1:
            default:

                if (aWidgetParameter.length > 0) {
                    const users = aWidgetParameter[0].split(/\s*,\s*/);

                    ARGUMENTS.users = users || ARGUMENTS.users;
                }
        }
    }
};

//------------------------------------------------
// found on : https://stackoverflow.com/a/32638472
// thanks @D.Deriso
const abbreviateNumber = (num, fixed) => {
  
    // terminate early
    if (num === null) {
        return null;
    }

    // terminate early
    if (num === 0) {
        return '0';
    }

    fixed = (!fixed || fixed < 0) ? 0 : fixed; // number of decimal places to show
    const b = (num).toPrecision(2).split('e'), // get power
        k = b.length === 1 ? 0 : Math.floor(Math.min(b[1].slice(1), 14) / 3), // floor at decimals, ceiling at trillions
        c = k < 1 ? num.toFixed(0 + fixed) : (num / Math.pow(10, k * 3) ).toFixed(1 + fixed), // divide by power
        d = c < 0 ? c : Math.abs(c), // enforce -0 is 0
        e = d + ['', 'K', 'M', 'B', 'T'][k]; // append power

    return e;
};

const MENU_ROWS = {
    title: {
        isHeader: true,
        title: 'Instagram Latest Widget',
        subtitle: `version: ${VERSION}`,
        onSelect: undefined
    },
    checkUpdate: {
        isHeader: false,
        title: 'Check for Updates',
        subtitle: 'Check for updates to the latest version.',
        onSelect: async () => {
            InstagramClient.updateModule();
        }
    },
    preview: {
        isHeader: false,
        title: 'Preview Widget',
        subtitle: 'Provides a preview for testing.',
        onSelect: async () => {

           if (ARGUMENTS.isNeedLogin) {
            await InstagramClient.startSession();
           }   
            
            const options = [...WIDGET_FAMILY, 'Cancel'];
            const resp = await InstagramClient.presentAlert('Preview Widget', options);
    
            if (resp === options.length - 1) {
                return;
            }
    
            const size = options[resp];
            const widget = await createLatestPostWidget(getRandom(ARGUMENTS.users), size.toLowerCase());
            
            await widget[`present${size}`]();
        }
    },
    clearCache: {
        isHeader: false,
        title: 'Clear cache',
        subtitle: 'Clear all caches.',
        onSelect: async () => {
            await InstagramClient.removeSession();
        }
    }
};

checkWidgetParameter();

// Wisget code -----------------------------------
InstagramClient.initialize();
//await InstagramClient.logout()

// choose a random username and fetch for the user
// information

if (config.runsInWidget) {
    Script.setWidget(await createLatestPostWidget(getRandom(ARGUMENTS.users)));
} else {
    const menu = new UITable();
    menu.showSeparators = true;

    Object.values(MENU_ROWS).forEach((rowInfo) => {
        const row = new UITableRow();
        row.isHeader = rowInfo.isHeader;
        row.dismissOnSelect = MENU_PROPERTY.rowDismiss;
        row.height = MENU_PROPERTY.rowHeight;
        const cell = row.addText(rowInfo.title, rowInfo.subtitle);
        cell.subtitleColor = MENU_PROPERTY.subtitleColor;
        row.onSelect = rowInfo.onSelect;
        menu.addRow(row);
    });

    await menu.present(false);
}

Script.complete();
