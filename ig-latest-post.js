// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: camera-retro;
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

const DEBUG = false;
const isNeedLogin = false;
const log = (args) => {

    if (DEBUG) {
        console.log(args);
    }
};

const ARGUMENTS = {
    isNeedLogin: isNeedLogin,
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

// stuff to display at the bottom of the widget
const SHOW_USERNAME = true;
const SHOW_LIKES = true;
const SHOW_COMMENTS = true;

// only show the staus line is any of the
// status items are visible
const SHOW_STATUS_LINE = SHOW_USERNAME || SHOW_LIKES || SHOW_COMMENTS;

// pick up to 12 of the most recent posts and
// select randomly between those. 
const MAX_RECENT_POSTS = 12;

// desired interval in minutes to refresh the
// widget. This will only tell IOS that it's
// ready for a refresh, whether it actually 
// refreshes is up to IOS
const REFRESH_INTERVAL = 5; //mins


// DO NOT EDIT BEYOND THIS LINE ------------------

// InstagramClient module ------------------------
// const InstagramClient = importModule('InstagramClient')
// EMBED 
const InstagramClient = {
    //----------------------------------------------
    initialize: function () {
        try {
            if (ARGUMENTS.isNeedLogin) {
                this.USES_ICLOUD = module.filename.includes('Documents/iCloud~');
                this.fm = this.USES_ICLOUD ? FileManager.iCloud() : FileManager.local();
        
                // track the number of login attempts
                // so we don't get an infinite login screen
                this.loginAttempts = 0;
                this.MAX_ATTEMPTS = 2;
                
                this.root = this.fm.joinPath(this.fm.documentsDirectory(), '/cache/igclient');
                this.fm.createDirectory(this.root, true);
        
                this.sessionPath = this.fm.joinPath(this.root, 'session.json');
                this.sessionid = '';
            }
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    authenticate: async function () {
        try {
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
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
	logout: async function () {
        try {
            log(`session exists - ${this.fm.fileExists(this.sessionPath)}`);

            if (this.fm.fileExists(this.sessionPath)) {
                log('deleting session file');
    
                await this.fm.remove(this.sessionPath);
            }
    
            log('logging out');
    
            const webview = new WebView();
            await webview.loadURL('https://www.instagram.com/accounts/logout');
            //await webview.present(false);
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    startSession: async function () {
        try {
            let sessionCache = await this.readSession();
        
            if (sessionCache) {
                log(`cached sessionid ${sessionCache.sessionid}`);
                log(`session expires on ${new Date(sessionCache.expiresDate)}`);
            }
            
            if (!sessionCache || new Date() >= new Date(sessionCache.expiresDate)) {
                log('refreshing session cache');
    
                sessionCache = await this.authenticate();
                this.sessionid = sessionCache.sessionid;
            }
    
            return (sessionCache) ? this : null;
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    fetchData: async function (url) {
        try {
            log(`fetching ${url}`);

            const req = new Request(url);        
            req.headers = {
                Cookie: `${await this.getCookies()}`
            };
    
            try {
                //var response = await req.loadJSON();
                const response = await req.loadString();
    
                log(response);
    
                return JSON.parse(response);
            } catch (error) {
                throw new Error(error.message);
            }
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    getUserInfo: async function (username) {
        try {
            const response = await this.fetchData(`https://www.instagram.com/${username}/?__a=1`);
        
            if (Object.keys(response).length === 0) {
                throw new Error(`Invalid user - ${username}`);
            }

            return response.graphql.user;
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    getPostInfo: async function (shortcode) {
        try {
            const response = await this.fetchData(`https://www.instagram.com/p/${shortcode}/?__a=1`)
        
            if (Object.keys(response).length === 0) {
                throw new Error(`Invalid post`);
            }
            
            return response;
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    readSession: async function () {
        try {
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
    
            return undefined;
        } catch (e) {
            console.log(e.message);
        }
    },
    //----------------------------------------------
    saveSession: async function (json) {
        try {

            if (this.fm.fileExists(this.sessionPath)) {

                if (this.USES_ICLOUD) {
                    await this.fm.downloadFileFromiCloud(this.sessionPath);
                }
            }
    
            await this.fm.writeString(this.sessionPath, JSON.stringify(json));
        } catch (e) {
            console.log(e.message);
        }
    },
    getCookies: async function () {
        try {

            if (ARGUMENTS.isNeedLogin) {
                const session = await this.readSession();
                const cookies = session.cookies.map(cookie => {
                    log(`adding cookie ${cookie.name}`)
        
                    return `${cookie.name}=${cookie.value}`;
                }).join(';');
        
                log(`returning cookies = ${cookies}`);
        
                return cookies;
            }
    
            return '';
        } catch (e) {
            console.log(e.message);
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
            console.log(e.message);
        }
    }
};
// InstagramClient module ends -------------------

//------------------------------------------------
const createWidget = async (data, widgetFamily) => {
    widgetFamily = widgetFamily || config.widgetFamily;
    const padding = (widgetFamily === 'large') ? 12 : 10;
    const fontSize = (widgetFamily === 'large') ? 14 : 10;
    const img = await download('Image', data.display_url);
    const widget = new ListWidget();
    widget.refreshAfterDate = new Date((Date.now() + (1000 * 60 * REFRESH_INTERVAL)));
    widget.url = `https://www.instagram.com/p/${data.shortcode}`;
    widget.setPadding(padding, padding, padding, padding);
    widget.backgroundImage = img;

    if (SHOW_STATUS_LINE) {
        // add gradient with a semi-transparent 
        // dark section at the bottom. this helps
        // with the readability of the status line
        widget.backgroundGradient = newLinearGradient(['#ffffff00','#ffffff00','#00000088'], [0,0.75, 1]);

        // top spacer to push the bottom stack down
        widget.addSpacer();

        // horizontal stack to hold the status line
        const stats = widget.addStack();
        stats.layoutHorizontally();
        stats.centerAlignContent();
        stats.spacing = 3;

        if (SHOW_USERNAME) {
            const eUsr = addText(stats, `@${data.username}`,'left', fontSize);
        }

        // center spacer to push items to the sides
        stats.addSpacer();

        if (SHOW_LIKES) {
            const heart = addSymbol(stats, 'heart.fill', fontSize);
            const eLikes = addText(stats, abbreviateNumber(data.likes), 'right', fontSize);
        }

        if (SHOW_COMMENTS) {
            const msg = addSymbol(stats, 'message.fill', fontSize);
            const eComm = addText(stats, abbreviateNumber(data.comments), 'right', fontSize);
        }
    }

    return widget;
};

//------------------------------------------------
const addSymbol = (container, name, size) => {
    const sfIcon = SFSymbol.named(name);
    const icon = container.addImage(sfIcon.image);
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
const createErrorWidget = async (data) => {
    const widget = new ListWidget();
    widget.addSpacer();

    log(data.message);

    const text = widget.addText(data.message);
    text.textColor = Color.white();
    text.centerAlignText();

    widget.addSpacer();

    return widget;
};

//------------------------------------------------
const download = async (dType, url) => {
    const req = new Request(url);

    return await req[`load${dType}`](url);
};

//------------------------------------------------
const getLatestPost = async (username, maxRecent) => {
    try {

        if (ARGUMENTS.isNeedLogin) {
            await InstagramClient.startSession();
        }
    } catch (e) {
        log(`error encountered - ${e.message}`);

        return {
            has_error: true,
            message: e.message
        };
    }

    let user = undefined;

    try {
        user = await InstagramClient.getUserInfo(username);
    } catch(e) {
        log(`error encountered - ${e.message}`);

        return {
            has_error: true,
            message: e.message
        };
    }

    if (!user) {
        return {
            has_error: true,
            message: `not exists user\n${username}`
        };
    }

    if (user.is_private && !user.followed_by_viewer) { 
        return {
            has_error: true,
            message: `not following user\n${username}`
        };
    }

    maxRecent = maxRecent > 12 ? 12 : maxRecent;
    let idx = Math.floor(Math.random() * maxRecent);
    const visible_posts = user.edge_owner_to_timeline_media.edges.length - 1;

    idx =  visible_posts < idx ? visible_posts : idx;

    const rec = user.edge_owner_to_timeline_media.edges[idx].node;
    const resp = undefined;

    try {
        resp = await InstagramClient.getPostInfo(rec.shortcode);

        if (!resp) {
            return {
                has_error: true,
                message: `not responded post\n${rec.shortcode}`
            };
        }
    } catch(e) {
        log(`error encountered when getting post - ${e.message}`);

        return {
            has_error: true,
            message: e.message
        };
    }

    log(resp);

    const post = resp.graphql.shortcode_media;
    
    return {
        has_error: false,
        username: username,
        shortcode: post.shortcode,
        display_url: post.hasOwnProperty('display_resources') ? post.display_resources[post.display_resources.length - 1].src : post.display_url,
        is_video: post.is_video,
        comments: post.edge_media_preview_comment.count,
        likes: post.edge_media_preview_like.count
    };
};

//------------------------------------------------
const presentAlert = async (prompt, items, asSheet) => {
    const alert = new Alert();
    alert.message = prompt;
    
    for (const item of items) {
        alert.addAction(item);
    }

    return asSheet ? await alert.presentSheet() : await alert.presentAlert();
};

const checkWidgetParameter = () => {

    if (args.widgetParameter) {
        const aWidgetParameter = args.widgetParameter.split(/\s*\|\s*/);

        switch (aWidgetParameter.length) {
            case 1:
            default:

                if (aWidgetParameter.length > 0) {
                    const users = aWidgetParameter[1].split(/\s*,\s*/);

                    ARGUMENTS.users = users.trim() || ARGUMENTS.users;
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

checkWidgetParameter();

// Wisget code -----------------------------------
InstagramClient.initialize();
//await InstagramClient.logout()

// choose a random username and fetch for the user
// information
const post = await getLatestPost(getRandom(ARGUMENTS.users), MAX_RECENT_POSTS);

if (config.runsInWidget) {
    const widget = post.has_error ? await createErrorWidget(post) : await createWidget(post);
    Script.setWidget(widget);
} else {
    const options = ['Small', 'Medium', 'Large', 'Cancel'];
    const resp = await presentAlert('Preview Widget', options);

    if (resp === options.length - 1) {
        return;
    }

    const size = options[resp];
    const widget = post.has_error ? await createErrorWidget(post) : await createWidget(post, size.toLowerCase());
    
    await widget[`present${size}`]();
}

Script.complete();
