var SQL = null;
var db = null;
var sqliteStorageKey = 'codechatSQLite';

// スラッシュコマンドの定義
var SLASH_COMMANDS = [
    { name: 'open', description: 'ページを開く (thread, home, trend, follows, profile)' },
    { name: 'file', description: 'ファイル参照モードに移行' },
    { name: 'upload', description: 'ファイルを選択してアップロード' }
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
    if (typeof initSqlJs !== 'function') {
        return Promise.reject(new Error('SQLite ライブラリが読み込まれていません。'));
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
    var stmt = db.prepare(query);
    if (params) {
        stmt.bind(params);
    }
    var rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

function getUserById(id) {
    var rows = sqlQuery('SELECT name, id, password FROM users WHERE id = ?', [id]);
    return rows.length ? rows[0] : null;
}

function getUserByCredentials(id, password) {
    var rows = sqlQuery('SELECT name, id FROM users WHERE id = ? AND password = ?', [id, password]);
    return rows.length ? rows[0] : null;
}

function addUser(name, id, password) {
    db.run('INSERT INTO users VALUES (?, ?, ?)', [name, id, password]);
    saveDatabase();
}

function savePost(userName, userId, content, datetime, fileName, fileType, fileData) {
    db.run('INSERT INTO posts VALUES (?, ?, ?, ?, ?, ?, ?)', [userName, userId, content, datetime, fileName || null, fileType || null, fileData || null]);
    saveDatabase();
}

function getPosts() {
    return sqlQuery('SELECT user_name, user_id, content, datetime, file_name, file_type, file_data FROM posts ORDER BY rowid');
}

function getCurrentUser() {
    var id = localStorage.getItem('codechatCurrentUser');
    if (!id) {
        return null;
    }
    var user = getUserById(id);
    return user ? { id: user.id, name: user.name } : null;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
                    renderPosts(uploadPostsList);
                }
                uploadPostsList = null;
            };
            reader.readAsDataURL(file);
        } else {
            savePost(currentUser.name, currentUser.id, '', timeText, file.name, file.type, null);
            if (uploadPostsList) {
                showSystemNotice(uploadPostsList, 'アップロードしました: ' + file.name);
                renderPosts(uploadPostsList);
            }
            uploadPostsList = null;
        }
        uploadPostsList = null;
    });
    document.body.appendChild(hiddenFileInput);
    return hiddenFileInput;
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
    var trimmed = inputValue.trim();
    if (!trimmed.startsWith('//')) {
        return [];
    }
    
    var commandText = trimmed.slice(2).toLowerCase();
    
    if (commandText === '') {
        return SLASH_COMMANDS;
    }
    
    return SLASH_COMMANDS.filter(function (cmd) {
        return cmd.name.indexOf(commandText) === 0;
    });
}

function renderAutocompleteList(list, commands, selectedIndex) {
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
        li.setAttribute('data-command', cmd.name);
        li.innerHTML = '<span class="autocomplete-item-label">//' + escapeHtml(cmd.name) + '</span>' +
                       '<span class="autocomplete-item-desc">' + escapeHtml(cmd.description) + '</span>';
        list.appendChild(li);
    });
    
    list.classList.add('active');
}

function selectCommand(input, command) {
    input.value = '//' + command;
    var list = document.getElementById('autocomplete-list');
    if (list) {
        list.classList.remove('active');
        list.innerHTML = '';
    }
}

function handleSiteCommand(value, postsList) {
    var parts = value.trim().split(/\s+/);
    if (parts[0].indexOf('//') !== 0) {
        return false;
    }
    var command = parts[0].slice(2).toLowerCase();
    var argument = parts.slice(1).join(' ').trim();

    if (command === 'file') {
        updatePostTextPlaceholder();
        showSystemNotice(postsList, 'ファイル参照モードに移行しました。続けて //upload でファイルを選択してください。');
        return true;
    }

    if (command === 'upload') {
        var input = createHiddenFileInput();
        uploadPostsList = postsList;
        input.value = '';
        input.click();
        return true;
    }

    return false;
}

function renderPosts(postsList) {
    if (!postsList) {
        return;
    }
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
        postItem.innerHTML = '<div class="post-item__meta">' + escapeHtml(post.user_name) + ' @' + escapeHtml(post.user_id) + ' | ' + escapeHtml(post.datetime) + '</div>' +
            (htmlValue ? '<p class="post-item__content">' + htmlValue + '</p>' : '') + fileBlock;
        postsList.insertAdjacentElement('beforeend', postItem);
        if (window.MathJax && window.MathJax.typesetPromise) {
            window.MathJax.typesetPromise([postItem]).catch(function (err) {
                console.error('MathJax typeset error:', err);
            });
        }
    });
}

href = location.href;

var links = document.querySelectorAll('.nav-list > li > a');

for (var i = 0; i < links.length; i++) {
    if (links[i].href == href) {
        document.querySelectorAll('.nav-list > li')[i].classList.add('current');
    }
}

document.addEventListener('DOMContentLoaded', function () {
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
            
            // Tabキー処理で投稿フォームの開閉を切り替え
            document.addEventListener('keydown', function (event) {
                if (event.key === 'Tab') {
                    event.preventDefault();
                    postForm.classList.toggle('post-form--closed');
                    
                    // フォームが開いている場合、入力フィールドにフォーカスを移す
                    if (!postForm.classList.contains('post-form--closed') && postInput) {
                        postInput.focus();
                    }
                }
            });

            if (postsList) {
                renderPosts(postsList);
            }

            // オートコンプリート機能
            if (postInput) {
                var autocompleteList = document.getElementById('autocomplete-list');
                var currentSelectedIndex = -1;
                
                postInput.addEventListener('input', function () {
                    var value = postInput.value;
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
                    } else if (event.key === 'Enter' && currentSelectedIndex >= 0) {
                        event.preventDefault();
                        var selectedItem = items[currentSelectedIndex];
                        var command = selectedItem.getAttribute('data-command');
                        selectCommand(postInput, command);
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
                        selectCommand(postInput, command);
                        currentSelectedIndex = -1;
                        postInput.focus();
                    }
                });
            }

            if (postsList && postInput) {
                postForm.addEventListener('submit', function (event) {
                    event.preventDefault();

                    var value = postInput.value.trim();
                    if (value === '') {
                        return;
                    }

                    var commandMatch = value.match(/^\/\/open\s+(thread|home|trend|follows|profile)\s*$/i);
                    if (commandMatch) {
                        var target = commandMatch[1].toLowerCase();
                        var url = target === 'home' ? 'home.html' : target + '.html';
                        location.href = url;
                        return;
                    }

                    if (value.indexOf('//') === 0) {
                        if (handleSiteCommand(value, postsList)) {
                            postInput.value = '';
                            postInput.focus();
                            return;
                        }
                        alert('不明なコマンドです。例: //open thread');
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
        }
    }).catch(function (error) {
        console.error('SQLite 初期化エラー:', error);
    });
});