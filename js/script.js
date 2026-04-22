var SQL = null;
var db = null;
var sqliteStorageKey = 'codechatSQLite';

// スラッシュコマンドの定義
var SLASH_COMMANDS = [
    { 
        name: 'open', 
        description: 'ページを開く',
        arguments: [
            { name: 'home', description: 'ホームページ' },
            { name: 'thread', description: 'スレッド' },
            { name: 'follows', description: 'フォロー' },
            { name: 'profile', description: 'プロフィール' }
        ]
    },
    { 
        name: 'upload', 
        description: 'ファイルを選択してアップロード',
        arguments: []
    }
    ,{ 
        name: 'edit',
        description: 'プロフィール/アイコン/ヘッダーを編集',
        arguments: [
            { name: 'profile', description: '自己紹介文を編集' },
            { name: 'icon', description: 'アイコン画像を選択' },
            { name: 'header', description: 'ヘッダー画像を選択' }
        ]
    }
];

function base64ToUint8Array(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function uint8ArrayToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function saveDatabase() {
    try {
        var data = db.export();
        localStorage.setItem(sqliteStorageKey, uint8ArrayToBase64(data));
    } catch (err) {
        console.error('SQLite save error:', err);
    }
}

function loadDatabase() {
    var stored = localStorage.getItem(sqliteStorageKey);
    if (stored) {
        try {
            return new SQL.Database(base64ToUint8Array(stored));
        } catch (err) {
            console.error('SQLite load error:', err);
        }
    }
    return new SQL.Database();
}

function initDatabase() {
    // initSqlJsが読み込まれるまで待機
    if (typeof initSqlJs !== 'function') {
        console.warn('SQL.jsライブラリが読み込まれていません。1秒後に再試行します。');
        return new Promise(function(resolve, reject) {
            setTimeout(function() {
                if (typeof initSqlJs === 'function') {
                    resolve(initDatabase());
                } else {
                    console.error('SQL.jsライブラリの読み込みに失敗しました。');
                    reject(new Error('SQLite ライブラリが読み込まれていません。'));
                }
            }, 1000);
        }).then(function(result) {
            return result;
        }).catch(function(err) {
            console.error('SQLite初期化エラー:', err);
            throw err;
        });
    }

    return initSqlJs({
        locateFile: function (file) {
            return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/' + file;
        }
    }).then(function (SQLLib) {
        SQL = SQLLib;
        db = loadDatabase();
        db.run('CREATE TABLE IF NOT EXISTS users (name TEXT, id TEXT PRIMARY KEY, password TEXT)');
        db.run('CREATE TABLE IF NOT EXISTS posts (user_name TEXT, user_id TEXT, content TEXT, datetime TEXT, file_name TEXT, file_type TEXT, file_data TEXT)');
        ensurePostSchema();
        
        // デバッグ用アカウントを作成（存在しない場合）
        var debugUser = getUserById('lake666486');
        if (!debugUser) {
            addUser('Debug User', 'lake666486', 'lake666486');
        }
        var debugUser2 = getUserById('sharp4863');
        if (!debugUser2) {
            addUser('Debug User 2', 'sharp4863', 'sharp4863');
        }
        
        saveDatabase();
    });
}

function ensurePostSchema() {
    var columns = sqlQuery('PRAGMA table_info(posts)');
    var hasFileName = columns.some(function (col) { return col.name === 'file_name'; });
    var hasFileType = columns.some(function (col) { return col.name === 'file_type'; });
    var hasFileData = columns.some(function (col) { return col.name === 'file_data'; });
    if (!hasFileName) {
        db.run('ALTER TABLE posts ADD COLUMN file_name TEXT');
    }
    if (!hasFileType) {
        db.run('ALTER TABLE posts ADD COLUMN file_type TEXT');
    }
    if (!hasFileData) {
        db.run('ALTER TABLE posts ADD COLUMN file_data TEXT');
    }
}

function sqlQuery(query, params) {
    if (!db) {
        return [];
    }
    params = params || [];
    try {
        var stmt = db.prepare(query);
        if (params && params.length) stmt.bind(params);
        var rows = [];
        while (stmt.step()) {
            if (typeof stmt.getAsObject === 'function') {
                rows.push(stmt.getAsObject());
            } else {
                var ra = stmt.get();
                var cols = stmt.getColumnNames ? stmt.getColumnNames() : null;
                if (cols && cols.length === ra.length) {
                    var obj = {};
                    for (var i = 0; i < cols.length; i++) obj[cols[i]] = ra[i];
                    rows.push(obj);
                } else {
                    rows.push(ra);
                }
            }
        }
        try { stmt.free(); } catch (e) {}
        return rows;
    } catch (err) {
        console.error('SQL error:', err, query, params);
        return [];
    }
}
function addUser(name, id, password) {
    db.run('INSERT INTO users VALUES (?, ?, ?)', [name, id, password]);
    saveDatabase();
}

function getUserById(id) {
    if (!id) return null;
    var rows = sqlQuery('SELECT name, id, password FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return null;
    var r = rows[0];
    // support both object and array row formats
    return {
        name: (r.name !== undefined) ? r.name : (r[0] !== undefined ? r[0] : null),
        id: (r.id !== undefined) ? r.id : (r[1] !== undefined ? r[1] : null),
        password: (r.password !== undefined) ? r.password : (r[2] !== undefined ? r[2] : null)
    };
}

function getUserByCredentials(id, password) {
    var user = getUserById(id);
    if (!user) return null;
    return user.password === password ? { id: user.id, name: user.name } : null;
}

function savePost(userName, userId, content, datetime, fileName, fileType, fileData) {
    db.run('INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?)', [userName, userId, content, datetime, fileName || null, fileType || null, fileData || null]);
    saveDatabase();
}

function getPosts() {
    return sqlQuery('SELECT rowid, user_name, user_id, content, datetime, file_name, file_type, file_data FROM posts ORDER BY rowid DESC');
}

function deletePost(rowid) {
    db.run('DELETE FROM posts WHERE rowid = ?', [rowid]);
    saveDatabase();
}

function getCurrentUser() {
    var id = localStorage.getItem('codechatCurrentUser');
    if (!id) return null;
    var user = getUserById(id);
    return user ? { id: user.id, name: user.name } : null;
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
var userIconCache = {};
var iconEmojis = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦉', '🦇', '🐓', '🦃', '🦚', '🦜', '🦢', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖'];

function getUserIcon(userId) {
    if (userIconCache[userId]) {
        return userIconCache[userId];
    }
    
    // ユーザーIDから簡単なハッシュを計算
    var hash = 0;
    for (var i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash) + userId.charCodeAt(i);
        hash = hash & hash; // 32bitに変換
    }
    
    var iconIndex = Math.abs(hash) % iconEmojis.length;
    var icon = iconEmojis[iconIndex];
    userIconCache[userId] = icon;
    return icon;
}

var uploadPostsList = null;
var hiddenFileInput = null;

function createHiddenFileInput() {
    if (hiddenFileInput) {
        return hiddenFileInput;
    }
    hiddenFileInput = document.createElement('input');
    hiddenFileInput.type = 'file';
    hiddenFileInput.style.display = 'none';
    hiddenFileInput.addEventListener('change', function () {
        if (!this.files || !this.files.length) {
            return;
        }
        var file = this.files[0];
        var currentUser = getCurrentUser();
        if (!currentUser) {
            if (uploadPostsList) {
                showSystemNotice(uploadPostsList, 'アップロードするにはログインしてください。');
            }
            uploadPostsList = null;
            return;
        }

        var now = new Date();
        var pad = function (num) {
            return String(num).padStart(2, '0');
        };
        var timeText = now.getFullYear() + '/' + pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + '/' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

        if (/^image\//.test(file.type)) {
            var reader = new FileReader();
            reader.onload = function () {
                savePost(currentUser.name, currentUser.id, '', timeText, file.name, file.type, reader.result);
                if (uploadPostsList) {
                    showSystemNotice(uploadPostsList, 'アップロードしました: ' + file.name);
                    saveDatabase();
                    setTimeout(function() {
                        renderPosts(uploadPostsList);
                    }, 100);
                }
                uploadPostsList = null;
            };
            reader.readAsDataURL(file);
        } else {
            savePost(currentUser.name, currentUser.id, '', timeText, file.name, file.type, null);
            if (uploadPostsList) {
                showSystemNotice(uploadPostsList, 'アップロードしました: ' + file.name);
                saveDatabase();
                setTimeout(function() {
                    renderPosts(uploadPostsList);
                }, 100);
            }
            uploadPostsList = null;
        }
        uploadPostsList = null;
    });
    document.body.appendChild(hiddenFileInput);
    return hiddenFileInput;
}

// 画像編集用の隠し入力（アイコン/ヘッダー編集用）
var hiddenImageInput = null;
var imageEditHandler = null; // function(dataURL, file)

function createHiddenImageInput() {
    if (hiddenImageInput) return hiddenImageInput;
    hiddenImageInput = document.createElement('input');
    hiddenImageInput.type = 'file';
    hiddenImageInput.accept = 'image/*';
    hiddenImageInput.style.display = 'none';
    hiddenImageInput.addEventListener('change', function () {
        if (!this.files || !this.files.length) return;
        var file = this.files[0];
        var reader = new FileReader();
        reader.onload = function () {
            try {
                if (typeof imageEditHandler === 'function') {
                    imageEditHandler(reader.result, file);
                }
            } finally {
                imageEditHandler = null;
            }
        };
        reader.readAsDataURL(file);
    });
    document.body.appendChild(hiddenImageInput);
    return hiddenImageInput;
}

function showSystemNotice(postsList, text) {
    if (!postsList) {
        return;
    }
    var postItem = document.createElement('article');
    postItem.className = 'post-item post-item--system';
    postItem.innerHTML = '<div class="post-item__meta">System</div><p class="post-item__content">' + escapeHtml(text) + '</p>';
    postsList.insertAdjacentElement('beforeend', postItem);
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([postItem]).catch(function (err) {
            console.error('MathJax typeset error:', err);
        });
    }
}

function updatePostTextPlaceholder() {
    var input = document.getElementById('post-text');
    if (!input) {
        return;
    }
    input.placeholder = 'ここに投稿文を入力してください...';
}

function getMatchingCommands(inputValue) {
    if (!inputValue) return [];
    console.log('[autocomplete] getMatchingCommands input:', inputValue);
    // 正規化：先頭のスラッシュは1つに
    var normalized = inputValue.replace(/^\/+/, '/');
    if (!normalized.startsWith('/')) return [];

    // without leading '/'
    var withoutLead = normalized.slice(1);
    var parts = withoutLead.split(/\s+/);
    var commandText = (parts[0] || '').toLowerCase();
    var argumentText = parts.slice(1).join(' ').toLowerCase();
    var argumentTextTrimmed = argumentText.trim();
    // 末尾にスペースがある場合は引数入力が完了したと扱わず、候補を全表示する
    var argumentFilterText = hasTrailingSpace ? '' : argumentTextTrimmed;

    // まだコマンド文字列を入力していない場合（例: '/'）
    if (commandText === '') {
        return SLASH_COMMANDS.map(function (cmd) {
            return { type: 'command', name: cmd.name, description: cmd.description, displayText: '/' + cmd.name };
        });
    }

    var matchingCommands = SLASH_COMMANDS.filter(function (cmd) {
        return cmd.name.indexOf(commandText) === 0;
    });

    // ユーザーがスペースを入力した、または引数候補が既にある場合、
    // あるいはコマンドが完全一致している場合は引数を提案
    var hasTrailingSpace = /\s$/.test(normalized);
    var wantsArgs = hasTrailingSpace || parts.length > 1 || (matchingCommands.length === 1 && matchingCommands[0].name === commandText);
    if (matchingCommands.length === 1 && wantsArgs) {
        var cmd = matchingCommands[0];
        if (cmd.arguments && cmd.arguments.length > 0) {
                return cmd.arguments
                .filter(function (arg) {
                    return arg.name.indexOf(argumentFilterText) === 0;
                })
                .map(function (arg) {
                    return {
                        type: 'argument',
                        commandName: cmd.name,
                        name: arg.name,
                        description: arg.description,
                        displayText: '/' + cmd.name + ' ' + arg.name
                    };
                });
        }
        return [];
    }

    // デフォルトはコマンド候補
    return matchingCommands.map(function (cmd) {
        return { type: 'command', name: cmd.name, description: cmd.description, displayText: '/' + cmd.name };
    });
}

function renderAutocompleteList(list, commands, selectedIndex) {
    console.log('[autocomplete] renderAutocompleteList count=', commands.length, 'selected=', selectedIndex);
    if (!list) return;
    list.innerHTML = '';
    
    if (commands.length === 0) {
        list.classList.remove('active');
        return;
    }
    
    commands.forEach(function (cmd, index) {
        var li = document.createElement('li');
        li.className = 'autocomplete-item';
        if (index === selectedIndex) {
            li.classList.add('selected');
        }
        li.setAttribute('data-type', cmd.type);
        if (cmd.type === 'argument') {
            // argument items: store parent command name and argument separately
            li.setAttribute('data-command', cmd.commandName || '');
            li.setAttribute('data-argument', cmd.name);
            li.setAttribute('data-command-name', cmd.commandName);
        } else {
            li.setAttribute('data-command', cmd.name);
        }
        li.innerHTML = '<span class="autocomplete-item-label">' + escapeHtml(cmd.displayText) + '</span>' +
                       '<span class="autocomplete-item-desc">' + escapeHtml(cmd.description) + '</span>';
        list.appendChild(li);
    });
    
    list.classList.add('active');
}

function selectCommand(input, command, argument) {
    if (argument) {
        input.value = '/' + command + ' ' + argument;
    } else {
        input.value = '/' + command;
    }
    var list = document.getElementById('autocomplete-list');
    if (list) {
        list.classList.remove('active');
        list.innerHTML = '';
    }
}

function renderProfilePosts(userPosts, userId, profilePostsList) {
    var currentUser = getCurrentUser();
    if (!profilePostsList) {
        return;
    }
    profilePostsList.innerHTML = '';
    userPosts.forEach(function (post) {
        var htmlValue = escapeHtml(post.content || '').replace(/\b(https?:\/\/[^\s]+|www\.[^\s]+)\b/g, function (url) {
            var href = url;
            if (href.indexOf('www.') === 0) {
                href = 'http://' + href;
            }
            return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>';
        });

        var fileBlock = '';
        if (post.file_name) {
            var fileName = escapeHtml(post.file_name);
            if (post.file_type && post.file_type.indexOf('image/') === 0 && post.file_data) {
                fileBlock = '<div class="post-item__file"><img src="' + escapeHtml(post.file_data) + '" alt="' + fileName + '"></div>';
            } else {
                fileBlock = '<div class="post-item__file">📎 ' + fileName + '</div>';
            }
        }

        var deleteButton = '';
        if (currentUser && currentUser.id === 'lake666486') {
            deleteButton = '<button class="post-item__delete" data-rowid="' + post.rowid + '" title="削除">🗑️</button>';
        }

        var userIcon = getUserIcon(post.user_id);
        var postItem = document.createElement('article');
        postItem.className = 'post-item';
        postItem.innerHTML = '<div class="post-item__meta"><span class="post-item__icon">' + userIcon + '</span> ' + escapeHtml(post.user_name) + ' @' + escapeHtml(post.user_id) + ' | ' + escapeHtml(post.datetime) + ' ' + deleteButton + '</div>' +
            (htmlValue ? '<p class="post-item__content">' + htmlValue + '</p>' : '') + fileBlock;
        profilePostsList.insertAdjacentElement('beforeend', postItem);
        
        // 削除ボタンにイベントリスナーを追加
        var deleteBtn = postItem.querySelector('.post-item__delete');
        if (deleteBtn) {
            (function(btn, rid) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (confirm('この投稿を削除しますか？')) {
                        deletePost(rid);
                        // プロフィールを再読み込み
                        var updatedPosts = sqlQuery('SELECT rowid, user_name, user_id, content, datetime, file_name, file_type, file_data FROM posts WHERE user_id = ? ORDER BY rowid DESC', [userId]);
                        renderProfilePosts(updatedPosts, userId, profilePostsList);
                        document.getElementById('profile-posts').textContent = updatedPosts.length;
                        
                        // メディアギャラリーも更新
                        var mediaGallery = document.getElementById('profile-media-gallery');
                        if (mediaGallery) {
                            mediaGallery.innerHTML = '';
                            var mediaItems = updatedPosts.filter(function (post) {
                                return post.file_type && post.file_type.indexOf('image/') === 0 && post.file_data;
                            });
                            
                            if (mediaItems.length === 0) {
                                var emptyMsg = document.createElement('p');
                                emptyMsg.className = 'upload-gallery-empty';
                                emptyMsg.textContent = 'メディアがありません';
                                mediaGallery.appendChild(emptyMsg);
                            } else {
                                mediaItems.forEach(function (item) {
                                    var mediaItem = document.createElement('div');
                                    mediaItem.className = 'profile-media-item';
                                    mediaItem.innerHTML = '<img src="' + escapeHtml(item.file_data) + '" alt="' + escapeHtml(item.file_name) + '">';
                                    mediaGallery.appendChild(mediaItem);
                                });
                            }
                        }
                    }
                });
            })(deleteBtn, post.rowid);
        }
        
        if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([postItem]).catch(function (err) {
                console.error('MathJax typeset error:', err);
            });
        }
    });
}

function handleSiteCommand(value, postsList) {
    var parts = value.trim().split(/\s+/);
    if (parts[0].indexOf('/') !== 0) {
        return false;
    }
    var command = parts[0].slice(1).toLowerCase();
    var argument = parts.slice(1).join(' ').trim();

    if (command === 'file') {
        updatePostTextPlaceholder();
        showSystemNotice(postsList, 'ファイル参照モードに移行しました。続けて /upload でファイルを選択してください。');
        return true;
    }

    if (command === 'upload') {
        var input = createHiddenFileInput();
        uploadPostsList = postsList;
        input.value = '';
        input.click();
        return true;
    }

    if (command === 'edit') {
        var partsArg = argument.split(/\s+/);
        var sub = partsArg[0] ? partsArg[0].toLowerCase() : '';
        var rest = partsArg.slice(1).join(' ').trim();
        var currentUser = getCurrentUser();
        if (!currentUser) {
            showSystemNotice(postsList, '編集にはログインが必要です。');
            return true;
        }

        if (sub === 'profile') {
            if (!rest) {
                showSystemNotice(postsList, '使用例: /edit profile ここに自己紹介文');
                return true;
            }
            localStorage.setItem('codechat_bio_' + currentUser.id, rest);
            showSystemNotice(postsList, 'プロフィールを更新しました。');
            // 更新が反映されるように DOM を更新
            var pd = document.getElementById('profile-display-text');
            var pb = document.getElementById('profile-bio');
            if (pd) pd.textContent = rest;
            if (pb) pb.textContent = rest;
            return true;
        }

        if (sub === 'icon' || sub === 'header') {
            imageEditHandler = function (dataURL, file) {
                var key = sub === 'icon' ? 'codechat_icon_' + currentUser.id : 'codechat_header_' + currentUser.id;
                try {
                    localStorage.setItem(key, dataURL);
                    showSystemNotice(postsList, (sub === 'icon' ? 'アイコン' : 'ヘッダー') + ' を保存しました。');
                } catch (e) {
                    console.error('Failed to save image to localStorage:', e);
                    if (e && e.name === 'QuotaExceededError') {
                        showSystemNotice(postsList, '画像が大きすぎて保存できません。サイズを小さくしてください。');
                    } else {
                        showSystemNotice(postsList, '画像の保存中にエラーが発生しました。');
                    }
                }
                // DOM 反映
                var avatarEl = document.querySelector('.profile-avatar');
                var bannerEl = document.querySelector('.profile-banner');
                try {
                    if (sub === 'icon' && avatarEl) {
                        avatarEl.innerHTML = '<img src="' + escapeHtml(dataURL) + '" alt="avatar">';
                    }
                    if (sub === 'header' && bannerEl) {
                        bannerEl.style.backgroundImage = 'url("' + escapeHtml(dataURL) + '")';
                    }
                } catch (err) {
                    console.error('DOM update error for image edit:', err);
                }
            };
            var imgInput = createHiddenImageInput();
            imgInput.value = '';
            imgInput.click();
            return true;
        }
        showSystemNotice(postsList, '対応していない /edit サブコマンドです。profile, icon, header を指定してください。');
        return true;
    }

    return false;
}

function renderPosts(postsList) {
    // 投稿は home.html のみで表示する
    var currentFile = (location.pathname || '').split('/').pop();
    if (currentFile !== 'home.html') return;
    if (!postsList) return;
    postsList.innerHTML = '';
    var posts = getPosts();
    posts.forEach(function (post) {
        var htmlValue = escapeHtml(post.content || '').replace(/\b(https?:\/\/[^\s]+|www\.[^\s]+)\b/g, function (url) {
            var href = url;
            if (href.indexOf('www.') === 0) {
                href = 'http://' + href;
            }
            return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>';
        });

        var fileBlock = '';
        if (post.file_name) {
            var fileName = escapeHtml(post.file_name);
            if (post.file_type && post.file_type.indexOf('image/') === 0 && post.file_data) {
                fileBlock = '<div class="post-item__file"><img src="' + escapeHtml(post.file_data) + '" alt="' + fileName + '"></div>';
            } else {
                fileBlock = '<div class="post-item__file">📎 ' + fileName + '</div>';
            }
        }

        var postItem = document.createElement('article');
        postItem.className = 'post-item';
        
        var currentUser = getCurrentUser();
        var deleteButton = '';
        if (currentUser && currentUser.id === 'lake666486') {
            deleteButton = '<button class="post-item__delete" data-rowid="' + post.rowid + '" title="削除">🗑️</button>';
        }
        
        var userIcon = getUserIcon(post.user_id);
        postItem.innerHTML = '<div class="post-item__meta"><span class="post-item__icon">' + userIcon + '</span> ' + escapeHtml(post.user_name) + ' @' + escapeHtml(post.user_id) + ' | ' + escapeHtml(post.datetime) + ' ' + deleteButton + '</div>' +
            (htmlValue ? '<p class="post-item__content">' + htmlValue + '</p>' : '') + fileBlock;
        postsList.insertAdjacentElement('afterbegin', postItem);
        
        // 削除ボタンにイベントリスナーを追加
        var deleteBtn = postItem.querySelector('.post-item__delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var rowid = parseInt(deleteBtn.getAttribute('data-rowid'), 10);
                if (confirm('この投稿を削除しますか？')) {
                    deletePost(rowid);
                    renderPosts(postsList);
                }
            });
        }
        
        if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([postItem]).catch(function (err) {
                console.error('MathJax typeset error:', err);
            });
        }
    });
}

// ナビリンクのハイライト処理：ハッシュやルート表記の違いを吸収して比較
(function () {
    var links = document.querySelectorAll('.nav-list > li > a');
    var currentPath = location.pathname || '/';
    if (currentPath === '/' || currentPath === '') {
        currentPath = '/index.html';
    }
    for (var i = 0; i < links.length; i++) {
        var li = document.querySelectorAll('.nav-list > li')[i];
        var linkPath = '';
        try {
            linkPath = new URL(links[i].href, location.origin).pathname;
        } catch (e) {
            var a = document.createElement('a');
            a.href = links[i].getAttribute('href');
            linkPath = a.pathname;
        }
        if (linkPath === '/' || linkPath === '') {
            linkPath = '/index.html';
        }
        if (linkPath === currentPath) {
            if (li) li.classList.add('current');
        }
    }
})();

document.addEventListener('DOMContentLoaded', function () {
    console.log('[app] DOMContentLoaded');
    initDatabase().then(function () {
        updatePostTextPlaceholder();
        var authTabs = document.querySelectorAll('.auth-tab');
        authTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                var target = tab.getAttribute('data-target');
                var activeTab = document.querySelector('.auth-tab--active');
                if (activeTab) {
                    activeTab.classList.remove('auth-tab--active');
                }
                tab.classList.add('auth-tab--active');

                var activeForm = document.querySelector('.auth-form--active');
                if (activeForm) {
                    activeForm.classList.remove('auth-form--active');
                }

                var targetForm = document.getElementById(target);
                if (targetForm) {
                    targetForm.classList.add('auth-form--active');
                }
            });
        });

        var signInForm = document.getElementById('sign-in');
        var signUpForm = document.getElementById('sign-up');

        function selectAuthTab(targetId) {
            var targetTab = document.querySelector('.auth-tab[data-target="' + targetId + '"]');
            if (!targetTab) {
                return;
            }
            var currentTab = document.querySelector('.auth-tab--active');
            if (currentTab) {
                currentTab.classList.remove('auth-tab--active');
            }
            targetTab.classList.add('auth-tab--active');
            var activeForm = document.querySelector('.auth-form--active');
            if (activeForm) {
                activeForm.classList.remove('auth-form--active');
            }
            var targetForm = document.getElementById(targetId);
            if (targetForm) {
                targetForm.classList.add('auth-form--active');
            }
        }

        if (signUpForm) {
            signUpForm.addEventListener('submit', function (event) {
                event.preventDefault();

                var name = signUpForm.querySelector('#signup-name').value.trim();
                var id = signUpForm.querySelector('#signup-id').value.trim();
                var password = signUpForm.querySelector('#signup-password').value;

                if (!name || !id || !password) {
                    alert('全ての項目を入力してください');
                    return;
                }

                if (getUserById(id)) {
                    alert('このIDは既に使われています。別のIDを選んでください。');
                    return;
                }

                addUser(name, id, password);
                alert('登録が完了しました。サインインしてください。');
                selectAuthTab('sign-in');
            });
        }

        if (signInForm) {
            signInForm.addEventListener('submit', function (event) {
                event.preventDefault();

                var id = signInForm.querySelector('#signin-id').value.trim();
                var password = signInForm.querySelector('#signin-password').value;

                if (!id || !password) {
                    alert('IDとパスワードを入力してください');
                    return;
                }

                var matched = getUserByCredentials(id, password);

                if (!matched) {
                    alert('IDまたはパスワードが間違っています。');
                    return;
                }

                localStorage.setItem('codechatCurrentUser', id);
                location.href = 'home.html';
            });
        }

        var postForm = document.querySelector('.post-form');
        if (postForm) {
            var postOpen = postForm.querySelector('.post-form__open');
            var postInput = postForm.querySelector('#post-text');
            var postsList = document.querySelector('.posts-list');

            if (postOpen) {
                postOpen.addEventListener('click', function () {
                    postForm.classList.remove('post-form--closed');
                });
            }
            
            // （削除済）Tabキーでのフォーム開閉は補完と競合するため無効化

            if (postsList) {
                renderPosts(postsList);
            }

            // オートコンプリート機能
            if (postInput) {
                var autocompleteList = document.getElementById('autocomplete-list');
                // autocomplete-list が存在しない場合は自動で生成して postInput の直後に差し込む
                if (!autocompleteList) {
                    autocompleteList = document.createElement('ul');
                    autocompleteList.id = 'autocomplete-list';
                    autocompleteList.className = 'autocomplete-list';
                    console.log('[autocomplete] created autocomplete-list element');
                    postInput.parentNode.insertBefore(autocompleteList, postInput.nextSibling);
                }
                var currentSelectedIndex = -1;
                
                postInput.addEventListener('input', function () {
                    var value = postInput.value;
                    console.log('[autocomplete] input event value=', value);
                    var commands = getMatchingCommands(value);
                    currentSelectedIndex = -1;
                    renderAutocompleteList(autocompleteList, commands, currentSelectedIndex);
                });
                
                postInput.addEventListener('keydown', function (event) {
                    var items = autocompleteList.querySelectorAll('.autocomplete-item');
                    var itemCount = items.length;
                    
                    if (itemCount === 0) {
                        return;
                    }
                    
                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        currentSelectedIndex = Math.min(currentSelectedIndex + 1, itemCount - 1);
                        renderAutocompleteList(autocompleteList, getMatchingCommands(postInput.value), currentSelectedIndex);
                        autocompleteList.querySelectorAll('.autocomplete-item')[currentSelectedIndex].scrollIntoView(false);
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        currentSelectedIndex = Math.max(currentSelectedIndex - 1, -1);
                        renderAutocompleteList(autocompleteList, getMatchingCommands(postInput.value), currentSelectedIndex);
                        if (currentSelectedIndex >= 0) {
                            autocompleteList.querySelectorAll('.autocomplete-item')[currentSelectedIndex].scrollIntoView(false);
                        }
                    } else if (event.key === 'Tab') {
                        event.preventDefault();
                        var items = autocompleteList.querySelectorAll('.autocomplete-item');
                        var itemCount = items.length;
                        if (itemCount === 0) return;

                        // 次の候補へ循環（選択のみ行い、入力値は変更しない）
                        currentSelectedIndex = (currentSelectedIndex + 1) % itemCount;
                        renderAutocompleteList(autocompleteList, getMatchingCommands(postInput.value), currentSelectedIndex);
                        // 選択項目をスクロールして見えるようにする
                        items = autocompleteList.querySelectorAll('.autocomplete-item');
                        var sel = items[currentSelectedIndex];
                        if (sel) {
                            sel.scrollIntoView(false);
                        }
                    
                    } else if (event.key === 'Enter' && currentSelectedIndex >= 0) {
                        event.preventDefault();
                        var selectedItem = items[currentSelectedIndex];
                        var command = selectedItem.getAttribute('data-command');
                        var argument = selectedItem.getAttribute('data-argument');
                        selectCommand(postInput, command, argument);
                        currentSelectedIndex = -1;
                    } else if (event.key === 'Escape') {
                        autocompleteList.classList.remove('active');
                        currentSelectedIndex = -1;
                    }
                });
                
                postInput.addEventListener('blur', function () {
                    setTimeout(function () {
                        autocompleteList.classList.remove('active');
                        currentSelectedIndex = -1;
                    }, 200);
                });
                
                // リスト項目のクリック処理
                document.addEventListener('click', function (event) {
                    if (event.target.closest('.autocomplete-item')) {
                        var item = event.target.closest('.autocomplete-item');
                        var command = item.getAttribute('data-command');
                        var argument = item.getAttribute('data-argument');
                        selectCommand(postInput, command, argument);
                        currentSelectedIndex = -1;
                        postInput.focus();
                    }
                });
            }

            if (postInput) {
                // submit ハンドラは投稿リストの有無にかかわらず登録する
                postForm.addEventListener('submit', function (event) {
                    event.preventDefault();

                    var value = postInput.value.trim();
                    if (value === '') {
                        return;
                    }

                    // 先頭のスラッシュは1つに正規化（//open などにも対応）
                    var normalized = value.replace(/^\/+/, '/');

                    var commandMatch = normalized.match(/^\/open\s+(thread|home|follows|profile)\s*$/i);
                    if (commandMatch) {
                        var target = commandMatch[1].toLowerCase();
                        var url = target === 'home' ? 'home.html' : target + '.html';
                        location.href = url;
                        return;
                    }

                    if (normalized.indexOf('/') === 0) {
                        if (handleSiteCommand(normalized, postsList)) {
                            postInput.value = '';
                            postInput.focus();
                            return;
                        }
                        alert('不明なコマンドです。例: /open thread');
                        return;
                    }

                    // コマンドでなければ投稿扱い。ただし投稿はホーム画面（postsListがある場合）のみ許可する
                    if (!postsList) {
                        alert('投稿はホーム画面で行ってください。');
                        return;
                    }

                    var now = new Date();
                    var pad = function (num) {
                        return String(num).padStart(2, '0');
                    };
                    var timeText = now.getFullYear() + '/' + pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + '/' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

                    var currentUser = getCurrentUser();
                    if (!currentUser) {
                        alert('投稿するにはログインしてください。');
                        return;
                    }

                    savePost(currentUser.name, currentUser.id, value, timeText);
                    renderPosts(postsList);

                    postInput.value = '';
                    postInput.focus();
                });
            }

            // プロフィール画面の初期化
            var profileName = document.getElementById('profile-name');
            var profileId = document.getElementById('profile-id');
            var profileEditForm = document.getElementById('profile-edit-form');
            var profileBioInput = document.getElementById('profile-bio-input');
            var profileDisplayText = document.getElementById('profile-display-text');
            
            if (profileName && profileId) {
                var currentUser = getCurrentUser();
                if (currentUser) {
                    profileName.textContent = currentUser.name;
                    profileId.textContent = '@' + currentUser.id;
                    
                    // 現在のユーザーの投稿数を取得して表示
                    var userPosts = sqlQuery('SELECT rowid FROM posts WHERE user_id = ? ORDER BY rowid DESC', [currentUser.id]);
                    document.getElementById('profile-posts').textContent = userPosts.length;
                    
                    // プロフィール自己紹介を読み込み
                    var userBio = localStorage.getItem('codechat_bio_' + currentUser.id) || '';
                    if (profileBioInput) {
                        profileBioInput.value = userBio;
                    }
                    if (profileDisplayText) {
                        profileDisplayText.textContent = userBio || 'まだプロフィール情報がありません。';
                    }
                    // アイコンとヘッダー画像を読み込み
                    var iconData = localStorage.getItem('codechat_icon_' + currentUser.id);
                    var headerData = localStorage.getItem('codechat_header_' + currentUser.id);
                    var avatarEl = document.querySelector('.profile-avatar');
                    var bannerEl = document.querySelector('.profile-banner');
                    if (iconData && avatarEl) {
                        try { avatarEl.innerHTML = '<img src="' + escapeHtml(iconData) + '" alt="avatar">'; } catch (e) {}
                    }
                    if (headerData && bannerEl) {
                        try { bannerEl.style.backgroundImage = 'url("' + escapeHtml(headerData) + '")'; } catch (e) {}
                    }
                    
                    // プロフィール編集フォームのサブミット処理
                    if (profileEditForm) {
                        profileEditForm.addEventListener('submit', function (e) {
                            e.preventDefault();
                            var bioText = profileBioInput.value.trim();
                            localStorage.setItem('codechat_bio_' + currentUser.id, bioText);
                            profileDisplayText.textContent = bioText || 'まだプロフィール情報がありません。';
                            alert('プロフィールを保存しました。');
                        });
                    }
                } else {
                    location.href = 'index.html';
                }
            }
        }
    }).catch(function (error) {
        console.error('SQLite 初期化エラー:', error);
        alert('システム初期化エラーが発生しました。ページをリロードしてください。');
    });
});
