/*! Copyright © 2009-2013 Postcode Anywhere (Holdings) Ltd. (http://www.postcodeanywhere.co.uk)
*
* Address v3.00
* Component for address lookup integrations.
*
* WEB-1-2 24/05/2013 14:28:04
*/

(function (window, undefined) {
    var pca = window.pca = window.pca || {},
        document = window.document;

    ///<summary>Service target information</summary>
    pca.protocol = (window.location || document.location).protocol == "https:" ? "https:" : "http:";
    pca.host = "services.postcodeanywhere.co.uk";
    pca.endpoint = "json3.ws";
    pca.limit = 2000;

    ///<summary>Synonyms for list filtering.</summary>
    ///<remarks>Only need to replace things at the start of item text.</remarks>
    pca.synonyms = [
        { r: /\bN(?=\s)/, w: "NORTH" },
        { r: /\b(?:NE|NORTHEAST)(?=\s)/, w: "NORTH EAST" },
        { r: /\b(?:NW|NORTHWEST)(?=\s)/, w: "NORTH WEST" },
        { r: /\bS(?=\s)/, w: "SOUTH" },
        { r: /\b(?:SE|SOUTHEAST)(?=\s)/, w: "SOUTH EAST" },
        { r: /\b(?:SW|SOUTHWEST)(?=\s)/, w: "SOUTH WEST" },
        { r: /\bE(?=\s)/, w: "EAST" },
        { r: /\bW(?=\s)/, w: "WEST" },
        { r: /\bST(?=\s)/, w: "SAINT" }
    ];

    ///<summary>Basic diacritic replacements.</summary>
    pca.diacritics = [
        { r: /[ÀÁÂÃ]/gi, w: "A" },
        { r: /Å/gi, w: "AA" },
        { r: /[ÆæÄ]/gi, w: "AE" },
        { r: /Ç/gi, w: "C" },
        { r: /Ð/gi, w: "DJ" },
        { r: /[ÈÉÊË]/gi, w: "E" },
        { r: /[ÌÍÏ]/gi, w: "I" },
        { r: /Ñ/gi, w: "N" },
        { r: /[ÒÓÔÕ]/gi, w: "O" },
        { r: /[ŒØÖ]/gi, w: "OE" },
        { r: /Š/gi, w: "SH" },
        { r: /ß/gi, w: "SS" },
        { r: /[ÙÚÛ]/gi, w: "U" },
        { r: /Ü/gi, w: "UE" },
        { r: /[ŸÝ]/gi, w: "ZH" },
        { r: /-/gi, w: " " },
        { r: /[.,]/gi, w: "" }
    ];

    ///<summary>HTML encoded character replacements.</summary>
    pca.hypertext = [
        { r: /&/g, w: "&amp;" },
        { r: /"/g, w: "&quot;" },
        { r: /'/g, w: "&#39;" },
        { r: /</g, w: "&lt;" },
        { r: />/g, w: "&gt;" }
    ];

    ///<summary>Current service requests.</summary>
    pca.requests = [];
    pca.requestQueue = [];
    pca.waitingRequest = false;
    pca.blockRequests = false;

    ///<summary>Current style fixes</summary>
    pca.styleFixes = [];

    ///<summary>Ready state</summary>
    var ready = false,
        readyList = [];

    ///<summary>Base object which supports events model.</summary>
    pca.Object = function (source) {
        var obj = source || this;

        obj.listeners = {};

        ///<summary>Listen to a PCA event.</summary>
        obj.listen = function (event, action) {
            obj.listeners[event] = obj.listeners[event] || [];
            obj.listeners[event].push(action);
        }

        ///<summary>Ignore a PCA event.</summary>
        obj.ignore = function (event, action) {
            if (obj.listeners[event]) {
                for (var i = 0; i < obj.listeners[event].length; i++) {
                    if (obj.listeners[event][i] === action) {
                        obj.listeners[event].splice(i, 1);
                        break;
                    }
                }
            }
        }

        ///<summary>Fire a PCA event.</summary>
        ///<remarks>Can take any number of additional paramters and pass them on to the listeners.</remarks>
        obj.fire = function (event, data) {
            if (obj.listeners[event]) {
                for (var i = 0; i < obj.listeners[event].length; i++) {
                    //obj.listeners[event][i](data);
                    var args = [data];

                    for (var a = 2; a < arguments.length; a++)
                        args.push(arguments[a]);

                    obj.listeners[event][i].apply(obj, args);
                }
            }
        }

        return obj;
    }

    ///<summary>Represents a service request</summary>
    ///<param name="service">The service name. <example>CapturePlus/Interactive/AutoComplete/v2.00</example></param>
    ///<param name="data">An object containing request parameters, such as key.</param>
    ///<param name="success">A callback function for successful requests.</param>
    ///<param name="error">A callback function for errors.</param>
    pca.Request = function (service, data, success, error) {
        var request = new pca.Object(this);

        request.service = service || "";
        request.data = data || {};
        request.success = success || function () { };
        request.error = error || function () { };
        request.response = null;

        request.cache = !!request.data.$cache; //request will not be deleted, other requests for the same data will return this response
        request.queue = !!request.data.$queue; //queue this request until other request is finished
        request.block = !!request.data.$block; //other requests will be blocked until this request is finished, only the last request will be queued
        request.post = !!request.data.$post; //force the request to be made using a HTTP POST

        request.callback = function (response) {
            request.response = response;
            processResponse(request);
        }

        request.index = pca.requests.length;
        pca.requests.push(request);
    }

    ///<summary>Called when document is ready.</summary>
    ///<remarks>Function handlers can be submitted and will run then document is ready.</remarks>
    pca.ready = function (delegate) {
        if (ready) {
            //process waiting handlers first
            if (readyList.length) {
                var handlers = readyList;

                readyList = [];

                for (var i = 0; i < handlers.length; i++)
                    handlers[i]();
            }

            if (delegate) delegate();
        }
        else if (typeof delegate == 'function')
            readyList.push(delegate);
    }

    ///<summary>Checks document load.</summary>
    function documentLoaded() {
        if (document.addEventListener) {
            pca.ignore(document, "DOMContentLoaded", documentLoaded);
            ready = true;
            pca.ready();
        }
        else if (document.readyState === "complete") {
            pca.ignore(document, "onreadystatechange", documentLoaded);
            ready = true;
            pca.ready();
        }
    }

    ///<summary>Listen for document load.</summary>
    function checkDocumentLoad() {
        if (document.readyState === "complete") {
            ready = true;
            pca.ready();
        }
        else {
            if (document.addEventListener) pca.listen(document, "DOMContentLoaded", documentLoaded);
            else pca.listen(document, "onreadystatechange", documentLoaded);
            pca.listen(window, "load", documentLoaded);
        }
    }

    ///<summary>Simple method for making a Postcode Anywhere service request</summary>
    ///<param name="service">The service name. <example>CapturePlus/Interactive/AutoComplete/v2.00</example></param>
    ///<param name="data">An object containing request parameters, such as key.</param>
    ///<param name="success">A callback function for successful requests.</param>
    ///<param name="error">A callback function for errors.</param>
    pca.fetch = function (service, data, success, error) {
        processRequest(new pca.Request(service, data, success, error));
    }

    ///<summary>decide what to do with the request.</summary>
    function processRequest(request) {

        //block requests if the flag is set, ignore all but the last request in this state
        if (pca.blockRequests && pca.waitingRequest) {
            pca.requestQueue = [request.index];
            return;
        }

        if (request.block)
            pca.blockRequests = true;

        //queue the request if flag is set
        if (request.queue) {
            if (pca.waitingRequest) {
                pca.requestQueue.push(request.index);
                return;
            }
        }

        pca.waitingRequest = true;

        //check the cache if the flag is set
        if (request.cache) {
            for (var i = 0; i < pca.requests.length; i++) {
                if (pca.requests[i] && pca.requests[i].service === request.service && pca.requests[i].response) {
                    var cacheHit = true;

                    for (var d in request.data) {
                        if (request.data[d] !== pca.requests[i].data[d]) {
                            cacheHit = false;
                            break;
                        }
                    }

                    if (cacheHit) {
                        request.callback(pca.requests[i].response);
                        pca.requests[request.index] = null;
                        return;
                    }
                }
            }
        }

        //make the request
        request.post ? postRequest(request) : getRequest(request);
    }

    ///<summary>Receives and processes the service response.</summary>
    function processResponse(request) {
        pca.waitingRequest = false;

        if (request.block)
            pca.blockRequests = false;

        if (request.response.Items.length === 1 && request.response.Items[0].Error !== undefined)
            request.error(request.response.Items[0].Description);
        else
            request.success(request.response.Items);

        if (!request.cache)
            pca.requests[request.index] = null;

        if (pca.requestQueue.length)
            processRequest(pca.requests[pca.requestQueue.shift()]);
    }

    ///<summary>Makes a GET request using best method availble.</summary>
    ///<remarks>Security must be bypassed in Internet Explorer up to version 10.</remarks>
    function getRequest(request) {
        navigator.appName == 'Microsoft Internet Explorer' ? getRequestScript(request) : getRequestXHR(request);
    }

    ///<summary>Makes a service request using a XMLHttpRequest GET method.</summary>
    function getRequestXHR(request) {
        var xhr = new XMLHttpRequest(),
            url = pca.protocol + "//" + pca.host + "/" + request.service + "/" + pca.endpoint,
            query = "";

        for (var i in request.data)
            query += (query ? "&" : "?") + i + "=" + encodeURIComponent(request.data[i]);

        url += query;

        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4)
                request.callback(pca.parseJSON(xhr.responseText));
        }

        //if the src length is long and likely to cause problems with url limits we should make a POST request
        if (url.length > pca.limit) {
            request.post = true;
            postRequest(request);
        }
        else {
            xhr.open("GET", url, true);
            xhr.send();
        }
    }

    ///<summary>Makes a service request using a script GET method.</summary>
    function getRequestScript(request) {
        var script = pca.create("script", { type: "text/javascript", async: "async" }),
            head = document.getElementsByTagName("head")[0],
            url = pca.protocol + "//" + pca.host + "/" + request.service + "/" + pca.endpoint,
            query = "";

        for (var i in request.data)
            query += (query ? "&" : "?") + i + "=" + encodeURIComponent(request.data[i]);

        query += "&callback=pca.requests[" + request.index + "].callback";
        script.src = url + query;

        script.onload = script.onreadystatechange = function () {
            if (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") {
                script.onload = script.onreadystatechange = null;
                if (head && script.parentNode)
                    head.removeChild(script);
            }
        }

        //if the src length is long and likely to cause problems with url limits we should make a POST request
        if (script.src.length > pca.limit) {
            request.post = true;
            postRequest(request);
        }
        else
            head.insertBefore(script, head.firstChild);
    }

    ///<summary>Makes a POST request using best method availble.</summary>
    ///<remarks>Security must be bypassed in Internet Explorer up to version 10.</remarks>
    function postRequest(request) {
        navigator.appName == 'Microsoft Internet Explorer' ? postRequestForm(request) : postRequestXHR(request);
    }

    ///<summary>Makes a service request using a XMLHttpRequest POST method.</summary>
    function postRequestXHR(request) {
        var xhr = new XMLHttpRequest(),
            url = pca.protocol + "//" + pca.host + "/" + request.service + "/" + pca.endpoint,
            query = "";

        for (var i in request.data)
            query += (query ? "&" : "") + i + "=" + encodeURIComponent(request.data[i]);

        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4)
                request.callback(pca.parseJSON(xhr.responseText));
        }

        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.send(query);
    }

    ///<summary>Makes a service request using a form POST method.</summary>
    function postRequestForm(request) {
        var form = document.createElement("form"),
            iframe = document.createElement("iframe"),
            loaded = false;

        function addParameter(name, value) {
            var field = document.createElement("input");
            field.name = name;
            field.value = value;
            form.appendChild(field);
        }

        form.method = "POST";
        form.action = pca.protocol + "//" + pca.host + "/" + request.service + "/json.ws";

        for (var key in request.data)
            addParameter(key, request.data[key])

        addParameter("CallbackVariable", "window.name");
        addParameter("CallbackWithScriptTags", "true");

        iframe.onload = function () {
            if (!loaded) {
                loaded = true;
                iframe.contentWindow.location = "about:blank";
            }
            else {
                request.callback({ Items: pca.parseJSON(iframe.contentWindow.name) });
                document.body.removeChild(iframe);
            }
        }

        iframe.style.display = "none";
        document.body.appendChild(iframe);

        var doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.body ? doc.body.appendChild(form) : doc.appendChild(form);
        form.submit();
    }

    ///<summary>Dynamically load an additional script.</summary>
    pca.loadScript = function (name, callback) {
        var script = pca.create("script", { type: "text/javascript" }),
            head = document.getElementsByTagName("head")[0];

        script.onload = script.onreadystatechange = function () {
            if (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") {
                script.onload = script.onreadystatechange = null;
                (callback || function () { })();
            }
        }

        script.src = (~name.indexOf("/") ? "" : pca.protocol + "//" + pca.host + "/js/") + name;
        head.insertBefore(script, head.firstChild);
    }

    ///<summary>Dynamically load an additional style sheet.</summary>
    pca.loadStyle = function (name, callback) {
        var style = pca.create("link", { type: "text/css", rel: "stylesheet" }),
            head = document.getElementsByTagName("head")[0];

        style.onload = style.onreadystatechange = function () {
            if (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") {
                style.onload = style.onreadystatechange = null;
                (callback || function () { })();
            }
        }

        style.href = (~name.indexOf("/") ? "" : pca.protocol + "//" + pca.host + "/css/") + name;
        head.insertBefore(style, head.firstChild);
    }

    ///<summary>Represents an item of data with a HTML element.</summary>
    ///<param name="data">An object containing the data for the item.</param>
    pca.Item = function (data, format) {
        var item = new pca.Object(this),
            selectedClass = "selected";

        item.data = data;
        item.html = pca.formatLine(data, format);
        item.tag = pca.formatTag(item.html);
        item.element = pca.create("div", { className: "item", innerHTML: item.html, title: pca.removeHtml(item.html) });
        item.visible = true;

        //applies the highlight style
        item.highlight = function () {
            pca.addClass(item.element, selectedClass)
            item.fire("highlight");

            return item;
        }

        //mouse is over the item element
        item.mouseover = function () {
            item.fire("mouseover");
        }

        //mouse has left the item element
        item.mouseout = function () {
            item.fire("mouseout");
        }

        //removes the highlight style
        item.lowlight = function () {
            pca.removeClass(item.element, selectedClass)
            item.fire("lowlight");

            return item;
        }

        //fires the event to say the item has been selected
        item.select = function (event) {
            item.fire("select", item.data);

            return item;
        }

        //hides an item
        item.hide = function () {
            item.visible = false;
            item.element.style.display = "none";
            item.fire("hide");

            return item;
        }

        //shows an item
        item.show = function () {
            item.visible = true;
            item.element.style.display = "";
            item.fire("show");

            return item;
        }

        pca.listen(item.element, "mouseover", item.mouseover);
        pca.listen(item.element, "mouseout", item.mouseout);
        pca.listen(item.element, "click", item.select);

        return item;
    }

    ///<summary>Represents a collection of items.</summary>
    pca.Collection = function () {
        var collection = new pca.Object(this);

        collection.items = [];
        collection.selected = -1;
        collection.count = 0; //number of visible items

        //populates the collection with items
        collection.add = function (array, format, callback) {

            callback = callback || function () { };

            function createItem(data) {
                var item = new pca.Item(data, format);
                item.listen("mouseover", function () { collection.select(item); });
                item.listen("select", callback);
                collection.items.push(item);
            }

            if (array.length) {
                for (var i = 0; i < array.length; i++)
                    createItem(array[i]);
            }
            else createItem(array);

            collection.count += array.length;
            collection.fire("add");

            return collection;
        }

        //sort the items in the collection
        collection.sort = function (field) {
            collection.items.sort(function (a, b) {
                return field ? (a.data[field] > b.data[field] ? 1 : -1) : (a.tag > b.tag ? 1 : -1);
            });

            collection.fire("sort");

            return collection;
        }

        //reverse the order of the items
        collection.reverse = function () {
            collection.items.reverse();

            collection.fire("reverse");

            return collection;
        }

        //filters the items in the collection and hides all items that do not contain the term
        collection.filter = function (term) {
            var tag = pca.formatTag(term),
                count = collection.count;

            collection.count = 0;

            collection.all(function (item) {
                if (~item.tag.indexOf(tag)) {
                    item.show();
                    collection.count++;
                }
                else
                    item.hide();
            });

            if (count != collection.count)
                collection.fire("filter");

            return collection;
        }

        //clear all items in the collection
        collection.clear = function () {
            collection.items = [];
            collection.count = 0;
            collection.selected = -1;

            collection.fire("clear");

            return collection;
        }

        //runs a function for every item in the list or until false is returned
        collection.all = function (delegate) {
            for (var i = 0; i < collection.items.length; i++) {
                if (delegate(collection.items[i]) === false)
                    break;
            }

            return collection;
        }

        //sets the current selected item
        collection.select = function (item) {
            if (~collection.selected) collection.items[collection.selected].lowlight();
            collection.selected = collection.index(item);
            if (~collection.selected) collection.items[collection.selected].highlight();

            collection.fire("select");

            return collection;
        }

        //gets the index of an item
        collection.index = function (item) {
            for (var i = 0; i < collection.items.length; i++) {
                if (collection.items[i] == item)
                    return i;
            }

            return -1;
        }

        //returns the first visible item
        collection.first = function (delegate) {
            for (var i = 0; i < collection.items.length; i++) {
                if (!delegate ? collection.items[i].visible : delegate(collection.items[i]))
                    return collection.items[i];
            }

            return null;
        }

        //returns the last visible item
        collection.last = function (delegate) {
            for (var i = collection.items.length - 1; i >= 0; i--) {
                if (!delegate ? collection.items[i].visible : delegate(collection.items[i]))
                    return collection.items[i];
            }

            return null;
        }

        //returns the next visible item from the current selection
        collection.next = function (delegate) {
            for (var i = collection.selected + 1; i < collection.items.length; i++) {
                if (!delegate ? collection.items[i].visible : delegate(collection.items[i]))
                    return collection.items[i];
            }

            return collection.first();
        }

        //returns the previous visible item to the current selection
        collection.previous = function (delegate) {
            for (var i = collection.selected - 1; i >= 0; i--) {
                if (!delegate ? collection.items[i].visible : delegate(collection.items[i]))
                    return collection.items[i];
            }

            return collection.last();
        }

        return collection;
    }

    ///<summary>A HTML list to display items.</summary>
    pca.List = function () {
        var list = new pca.Object(this);

        list.element = pca.create("div", { className: "pca list" });
        list.collection = new pca.Collection();
        list.visible = true;
        list.scroll = {
            held: false,
            moved: false,
            origin: 0,
            position: 0,
            x: 0,
            y: 0,
            dx: 0,
            dy: 0
        }

        //shows the list
        list.show = function () {
            list.visible = true;
            list.element.style.display = "";
            list.fire("show");

            return list;
        }

        //hides the list
        list.hide = function () {
            list.visible = false;
            list.element.style.display = "none";
            list.fire("hide");

            return list;
        }

        //redraws the list by removing all children and adding them again
        list.draw = function () {
            list.destroy();

            list.collection.all(function (item) {
                list.element.appendChild(item.element);
            })

            list.fire("draw");

            return list;
        }

        //adds items to the list
        list.add = function (array, format, callback) {
            list.collection.add(array, format, callback);
            list.fire("add");
            list.draw();

            return list;
        }

        //destroys all items in the list
        list.destroy = function () {
            while (list.element.childNodes && list.element.childNodes.length)
                list.element.removeChild(list.element.childNodes[0]);

            return list;
        }

        //clears all items from the list
        list.clear = function () {
            list.collection.clear();
            list.destroy();
            list.fire("clear");

            return list;
        }

        //sets the scroll position of the list
        list.setScroll = function (position) {
            list.element.scrollTop = position;
            list.fire("scroll");

            return list;
        }

        //enables touch input for list scrolling
        list.enableTouch = function () {
            //touch events
            function touchStart(event) {
                event = event || window.event;
                list.scroll.held = true;
                list.scroll.moved = false;
                list.scroll.origin = parseInt(list.scrollTop);
                list.scroll.y = parseInt(event.touches[0].pageY);
            }

            function touchEnd() {
                list.scroll.held = false;
            }

            function touchCancel() {
                list.scroll.held = false;
            }

            function touchMove(event) {
                if (list.scroll.held) {
                    event = event || window.event;

                    //Disable Gecko and Webkit image drag
                    pca.smash(event);

                    list.scroll.dy = list.scroll.y - parseInt(event.touches[0].pageY);
                    list.scroll.position = list.scroll.origin + list.scroll.dy;
                    list.setScroll(list.scroll.position);
                    list.scroll.moved = true;
                }
            }

            pca.listen(list.element, "touchstart", touchStart);
            pca.listen(list.element, "touchmove", touchMove);
            pca.listen(list.element, "touchend", touchEnd);
            pca.listen(list.element, "touchcancel", touchCancel);

            return list;
        }

        //moves to the next item in the list
        list.next = function () {
            var item = list.collection.next();

            if (item) {
                list.collection.select(item);
                list.scrollToItem(item);
            }

            return list;
        }

        //moves to the previous item in the list
        list.previous = function () {
            var item = list.collection.previous();

            if (item) {
                list.collection.select(item);
                list.scrollToItem(item);
            }

            return list;
        }

        //calls the select function for the current item
        list.select = function () {
            if (list.selectable())
                list.collection.items[list.collection.selected].select();

            return list;
        }

        //returns true if the current item is selectable
        list.selectable = function () {
            return list.visible && !!list.collection.items[list.collection.selected];
        }

        //keyboard events
        list.navigate = function (key) {
            switch (key) {
                case 40: //down
                    list.next();
                    return true;
                case 38: //up
                    list.previous();
                    return true;
                case 13: //enter/return
                case 39: //right arrow
                    if (list.selectable()) {
                        list.select();
                        return true;
                    }
            }

            return false;
        }

        //scrolls the list to show an item
        list.scrollToItem = function (item) {
            list.scroll.position = list.element.scrollTop;

            if (item.element.offsetTop < list.scroll.position) {
                list.scroll.position = item.element.offsetTop;
                list.setScroll(list.scroll.position);
            }
            else {
                if (item.element.offsetTop + item.element.offsetHeight > list.scroll.position + list.element.offsetHeight) {
                    list.scroll.position = item.element.offsetTop + item.element.offsetHeight - list.element.offsetHeight;
                    list.setScroll(list.scroll.position);
                }
            }

            return list;
        }

        list.filter = function (term) {
            var current = list.collection.count;

            list.collection.filter(term);

            if (current != list.collection.count)
                list.fire("filter");

            return list;
        }

        return list;
    }

    ///<summary>Creates an autocomplete list which is bound to a field.</summary>
    pca.AutoComplete = function (fields, options) {
        var autocomplete = new pca.Object(this);

        autocomplete.options = options || {};

        autocomplete.element = pca.create("div", { className: "autocomplete text" });
        autocomplete.container = null;
        autocomplete.anchors = [];
        autocomplete.list = new pca.List();
        autocomplete.fieldListeners = [];
        autocomplete.field = null;
        autocomplete.positionField = null;
        autocomplete.visible = true;
        autocomplete.hover = false;
        autocomplete.focused = false;
        autocomplete.disabled = false;

        ///<summary>Header element.</summary>
        autocomplete.header = {
            element: pca.create("div", { className: "pcaheader" }),
            headerText: pca.create("div", { className: "pcamessage" }),

            init: function () {
                this.hide();
            },

            setContent: function (content) {
                content = content || "";
                typeof content == 'string' ? this.element.innerHTML = content : this.element.appendChild(content);
                autocomplete.fire("header");
                return this;
            },

            setText: function (text) {
                text = text || "";
                this.element.appendChild(this.headerText);
                typeof text == 'string' ? this.headerText.innerHTML = text : this.headerText.appendChild(text);
                autocomplete.fire("header");
                return this;
            },

            clear: function () {
                this.setContent();
                autocomplete.fire("header");
                return this;
            },

            show: function () {
                this.element.style.display = "";
                autocomplete.fire("header");
                return this;
            },

            hide: function () {
                this.element.style.display = "none";
                autocomplete.fire("header");
                return this;
            }
        }

        ///<summary>Footer element.</summary>
        autocomplete.footer = {
            element: pca.create("div", { className: "pcafooter" }),

            init: function () {
                this.hide();
            },

            setContent: function (content) {
                content = content || "";
                typeof content == 'string' ? this.element.innerHTML = content : this.element.appendChild(content);
                autocomplete.fire("footer");
                return this;
            },

            show: function () {
                this.element.style.display = "";
                autocomplete.fire("footer");
                return this;
            },

            hide: function () {
                this.element.style.display = "none";
                autocomplete.fire("footer");
                return this;
            }
        }

        ///<summary>Attach the list to field or list of fields provided.</summary>
        autocomplete.load = function () {

            if (fields.length && fields.constructor == Array) {
                for (var i = 0; i < fields.length; i++)
                    autocomplete.attach(pca.getElement(fields[i]));
            }
            else
                autocomplete.attach(pca.getElement(fields));

            pca.listen(autocomplete.element, "mouseover", function () { autocomplete.hover = true });
            pca.listen(autocomplete.element, "mouseout", function () { autocomplete.hover = false });
            pca.listen(document, "click", autocomplete.checkHide);

            if (document.documentMode && document.documentMode <= 7) {
                pca.applyStyleFixes(".pca .autocomplete", { width: "250px" });
            }

            if (document.documentMode && document.documentMode == 5) {
                pca.applyStyleFixes(".pca .autocomplete .list", { width: "248px" });
                pca.applyStyleFixes(".pca .footer", { fontSize: "0pt" });
                pca.applyStyleFixes(".pca .flag", { fontSize: "0pt" });
            }

            return autocomplete;
        }

        ///<summary>Attach the list to a field.</summary>
        autocomplete.attach = function (field) {

            function bindFieldEvent(f, event, action) {
                pca.listen(f, event, action);
                autocomplete.fieldListeners.push({ field: f, event: event, action: action });
            }

            function anchorToField(f) {
                var anchor = pca.create("table", { className: "anchor", cellPadding: 0, cellSpacing: 0 }),
                    chain = [anchor.insertRow(0).insertCell(0), anchor.insertRow(1).insertCell(0)],
                    container = pca.create("div", { className: "pca" }),
                    link = pca.create("div", { className: "chain" });

                function focus() {
                    autocomplete.field = f;
                    link.appendChild(autocomplete.element);
                    autocomplete.focus();
                    autocomplete.position(f);
                    autocomplete.fire("move");
                }

                //check the field
                if (!f || !f.tagName) {
                    addToPageContainer();
                    return;
                }

                f.parentNode.insertBefore(container, f);
                container.appendChild(anchor);
                chain[0].appendChild(f);
                chain[1].appendChild(link);
                autocomplete.anchors.push(container);

                if (pca.inputField(f)) {
                    bindFieldEvent(f, "keyup", autocomplete.keyup);
                    bindFieldEvent(f, "focus", focus);
                    bindFieldEvent(f, "blur", autocomplete.blur);
                    bindFieldEvent(f, "keypress", autocomplete.keypress);
                }

                bindFieldEvent(f, "click", function () { autocomplete.click(f); });
                bindFieldEvent(f, "dblclick", function () { autocomplete.dblclick(f); });
                bindFieldEvent(f, "change", function () { autocomplete.change(f); });
            }

            function positionAdjacentField(f) {
                function focus() {
                    autocomplete.field = f;
                    autocomplete.focus();
                    autocomplete.position(f);
                    autocomplete.fire("move");
                }

                addToPageContainer();

                //check the field
                if (!f || !f.tagName) return;

                if (pca.inputField(f)) {
                    bindFieldEvent(f, "keyup", autocomplete.keyup);
                    bindFieldEvent(f, "focus", focus);
                    bindFieldEvent(f, "blur", autocomplete.blur);
                    bindFieldEvent(f, "keypress", autocomplete.keypress);
                }

                bindFieldEvent(f, "click", function () { autocomplete.click(f); });
                bindFieldEvent(f, "dblclick", function () { autocomplete.dblclick(f); });
                bindFieldEvent(f, "change", function () { autocomplete.change(f); });
            }

            function addToPageContainer() {
                if (!autocomplete.container) {
                    autocomplete.container = pca.create("div", { className: "pca" });
                    document.body.appendChild(autocomplete.container);
                }

                autocomplete.container.appendChild(autocomplete.element);
            }

            autocomplete.options.force ? anchorToField(field) : positionAdjacentField(field);
        }

        ///<summary>Positions the autocomplete.</summary>
        autocomplete.position = function (field) {
            var fieldPosition = pca.getPosition(field),
                fieldSize = pca.getSize(field),
                topParent = pca.getTopOffsetParent(field),
                parentScroll = pca.getParentScroll(field),
                listSize = pca.getSize(autocomplete.element),
                windowSize = pca.getSize(window),
                windowScroll = pca.getScroll(window),
                fixed = !isPage(topParent);

            //should the popup open upwards
            if ((fieldPosition.top - (fixed ? 0 : windowScroll.top)) > listSize.height && (fieldPosition.top + listSize.height - (fixed ? 0 : windowScroll.top)) > windowSize.height) {
                if (autocomplete.options.force) {
                    autocomplete.element.style.top = -(listSize.height + fieldSize.height + 2) + "px";
                }
                else {
                    autocomplete.element.style.top = (fieldPosition.top - parentScroll.top - listSize.height) + (fixed ? windowScroll.top : 0) + "px";
                    autocomplete.element.style.left = (fieldPosition.left - parentScroll.left) + (fixed ? windowScroll.left : 0) + "px";
                }
            }
            else {
                if (autocomplete.options.force)
                    autocomplete.element.style.top = "auto";
                else {
                    autocomplete.element.style.top = ((fieldPosition.top - parentScroll.top) + fieldSize.height + 1) + (fixed ? windowScroll.top : 0) + "px";
                    autocomplete.element.style.left = (fieldPosition.left - parentScroll.left) + (fixed ? windowScroll.left : 0) + "px";
                }
            }

            //set minimum width for field
            var ownBorderWidth = (parseInt(pca.getStyle(autocomplete.element, "borderLeftWidth")) + parseInt(pca.getStyle(autocomplete.element, "borderRightWidth"))) || 0;
            autocomplete.element.style.minWidth = (pca.getSize(field).width - ownBorderWidth) + "px";
            autocomplete.positionField = field;

            return autocomplete;
        }

        autocomplete.reposition = function () {
            if (autocomplete.positionField) autocomplete.position(autocomplete.positionField);
            return autocomplete;
        }

        ///<summary>Shows the autocomplete.</summary>
        autocomplete.show = function () {
            if (!autocomplete.disabled) {
                autocomplete.visible = true;
                autocomplete.element.style.display = "";
                autocomplete.list.collection.count ? autocomplete.list.show() : autocomplete.list.hide();
                autocomplete.setScroll(0);
                autocomplete.reposition();
                autocomplete.fire("show");
            }
            return autocomplete;
        }

        ///<summary>Shows the autocomplete and all items without a filter.</summary>
        autocomplete.showAll = function () {
            autocomplete.list.filter("");
            autocomplete.show();
        }

        ///<summary>Hides the autocomplete.</summary>
        autocomplete.hide = function () {
            autocomplete.visible = false;
            autocomplete.element.style.display = "none";
            autocomplete.fire("hide");

            return autocomplete;
        }

        autocomplete.focus = function () {
            autocomplete.focused = true;
            autocomplete.show();

            autocomplete.fire("focus");
        }

        autocomplete.blur = function () {
            autocomplete.focused = false;
            autocomplete.checkHide();

            autocomplete.fire("blur");
        }

        autocomplete.checkHide = function () {
            if (autocomplete.visible && !autocomplete.focused && !autocomplete.hover)
                autocomplete.hide();

            return autocomplete;
        }

        autocomplete.keyup = function (event) {
            var key = window.event ? window.event.keyCode : event.which;

            if (key == 27) { //escape
                autocomplete.hide();
                autocomplete.fire("escape");
            }
            else if (key == 8 || key == 46) { //del or backspace
                autocomplete.filter();
                autocomplete.fire("delete");
            }
            else if (key != 0 && key <= 46) { //recognised non-character key
                if (autocomplete.visible && autocomplete.list.navigate(key))
                    pca.smash(event); //keys handled by the list, stop other events
                else if (key == 38 || key == 40) //up or down when list is hidden
                    autocomplete.filter();
            }
            else if (autocomplete.visible) //normal key press when list is visible
                autocomplete.filter();

            autocomplete.fire("keyup", key);
        }

        autocomplete.keypress = function (event) {
            var key = window.event ? window.event.keyCode : event.which;

            if (autocomplete.visible && key == 13 && autocomplete.list.selectable())
                pca.smash(event);
        }

        //field has been clicked
        autocomplete.click = function (f) {
            autocomplete.fire("click", f);
        }

        //field has been double clicked
        autocomplete.dblclick = function (f) {
            autocomplete.fire("dblclick", f);
        }

        //field value has been changed
        autocomplete.change = function (f) {
            autocomplete.fire("change", f);
        }

        ///<summary>Add items to the autocomplete list.</summary>
        ///<param name="array">An array of objects to add.</param>
        ///<param name="format">A format string to display items.</param>
        ///<param name="callback">A callback function for item select.</param>
        autocomplete.add = function (array, format, callback) {
            autocomplete.list.add(array, format, callback);

            return autocomplete;
        }

        ///<summary>Clears the autocomplete list.</summary>
        autocomplete.clear = function () {
            autocomplete.list.clear();

            return autocomplete;
        }

        ///<summary>Sets the scroll position of the autocomplete list.</summary>
        autocomplete.setScroll = function (position) {
            autocomplete.list.setScroll(position);

            return autocomplete;
        }

        ///<summary>Sets the width of the autocomplete list.</summary>
        autocomplete.setWidth = function (width) {
            autocomplete.element.style.width = width + "px";

            return autocomplete;
        }

        ///<summary>Filters the autocomplete list for items matching the supplied term.</summary>
        ///<param name="term">The term to search for
        ///<remarks>Case insensitive</remarks>
        ///</param>
        autocomplete.filter = function (term) {
            autocomplete.list.filter(term || pca.getValue(autocomplete.field));
            autocomplete.list.collection.count ? autocomplete.show() : autocomplete.hide();

            return autocomplete;
        }

        ///<summary>Removes the autocomplete elements and event listeners from the page.</summary>
        autocomplete.destroy = function () {
            if (autocomplete.container)
                document.body.removeChild(autocomplete.container);

            pca.ignore(document, "click", autocomplete.checkHide);

            for (var i = 0; i < autocomplete.fieldListeners.length; i++)
                pca.ignore(autocomplete.fieldListeners[i].field, autocomplete.fieldListeners[i].event, autocomplete.fieldListeners[i].action);
        }

        autocomplete.element.appendChild(autocomplete.header.element);
        autocomplete.element.appendChild(autocomplete.list.element);
        autocomplete.element.appendChild(autocomplete.footer.element);
        autocomplete.header.init();
        autocomplete.footer.init();

        if (fields) autocomplete.load(fields);
        autocomplete.hide();

        return autocomplete;
    }

    ///<summary>Creates a modal popup window.</summary>
    pca.Modal = function () {
        var modal = new pca.Object(this);

        modal.element = pca.create("div", { className: "modal" });
        modal.border = pca.create("div", { className: "border" });
        modal.frame = pca.create("div", { className: "frame" });
        modal.content = pca.create("div", { className: "content text" });
        modal.mask = pca.create("div", { className: "fullscreen mask" });

        ///<summary>Header element.</summary>
        modal.header = {
            element: pca.create("div", { className: "pcaheader" }),
            headerText: pca.create("div", { className: "pcatitle" }),

            init: function () {
                this.setText();
            },

            setContent: function (content) {
                content = content || "";
                typeof content == 'string' ? this.element.innerHTML = content : this.element.appendChild(content);
                modal.fire("header");
                return this;
            },

            setText: function (text) {
                text = text || "";
                this.element.appendChild(this.headerText);
                typeof text == 'string' ? this.headerText.innerHTML = text : this.headerText.appendChild(text);
                modal.fire("header");
                return this;
            },

            show: function () {
                this.element.style.display = "";
                modal.fire("header");
                return this;
            },

            hide: function () {
                this.element.style.display = "none";
                modal.fire("header");
                return this;
            }
        }

        modal.setContent = function (content) {
            typeof content == 'string' ? modal.content.innerHTML = content : modal.content.appendChild(content);
            modal.fire("change");

            return modal;
        }

        modal.centre = function () {
            var windowSize = pca.getSize(window),
                modalSize = pca.getSize(modal.element);

            modal.element.style.top = (windowSize.height / 2) - (modalSize.height / 2) + "px";
            modal.element.style.left = (windowSize.width / 2) - (modalSize.width / 2) + "px";

            return modal;
        }

        modal.show = function () {
            modal.element.style.display = "";
            modal.mask.style.display = "";
            modal.centre();
            modal.fire("show");

            return modal;
        }

        modal.hide = function () {
            modal.element.style.display = "none";
            modal.mask.style.display = "none";
            modal.fire("hide");

            return modal;
        }

        pca.listen(modal.mask, "click", modal.hide);

        modal.element.appendChild(modal.border);
        modal.element.appendChild(modal.frame);
        modal.frame.appendChild(modal.header.element);
        modal.frame.appendChild(modal.content);
        modal.header.init();

        var container = pca.create("div", { className: "pca" });
        container.appendChild(modal.mask);
        container.appendChild(modal.element);
        document.body.appendChild(container);

        modal.hide();

        return modal;
    }

    ///<summary>Formats a line by replacing tags in the form {Property} with the corresponding property value or method result from the item object.</summary>
    pca.formatLine = function (item, format) {
        return format.replace(/\{(\w+)\}/g, function (m, c) { return (typeof item[c] == 'function' ? item[c]() : item[c]) || ""; });
    }

    ///<summary>Formats a line into a simplified tag for filtering.</summary>
    pca.formatTag = function (line) {
        return line ? pca.replaceList(pca.replaceList(pca.removeHtml(line.toUpperCase()), pca.diacritics), pca.synonyms) : "";
    }

    ///<summary>Formats a line into a tag and then separate words.</summary>
    pca.formatTagWords = function (line) {
        return pca.formatTag(line).split(" ");
    }

    ///<summary>Formats camaelcase text by inserting a separator string.</summary>
    pca.formatCamel = function (line, separator) {
        separator = separator || " ";

        function separate(m, b, a) {
            return b + separator + a;
        }

        line = line.replace(/([a-z])([A-Z0-9])/g, separate); //before an upperase letter or number
        line = line.replace(/([0-9])([A-Z])/g, separate); //before an uppercase letter after a number
        line = line.replace(/([A-Z])([A-Z][a-z])/g, separate); //after multiple capital letters

        return line;
    }

    ///<summary>Performs all replacements in a list.</summary>
    pca.replaceList = function (line, list) {
        for (var i = 0; i < list.length; i++)
            line = line.toString().replace(list[i].r, list[i].w);
        return line;
    }

    ///<summary>Removes HTML tags from a string.</summary>
    pca.removeHtml = function (line) {
        return line.replace(/<(?:.|\s)*?>+/g, "");
    }

    ///<summary>Converts a html string for display.</summary>
    pca.escapeHtml = function (line) {
        return pca.replaceList(line, pca.hypertext);
    }

    ///<summary>Returns only the valid characters for a DOM id.</summary>
    pca.validId = function (line) {
        return /[a-z0-9-_:\.\[\]]+/gi.exec(line);
    }

    ///<summary>Removes unnecessary spaces</summary>
    pca.trimSpaces = function (line) {
        return line.replace(/^\s+|\s(?=\s)|\s$/g, "");
    }

    ///<summary>Removes unnecessary charaters</summary>
    pca.tidy = function (line, symbol) {
        symbol = symbol.replace("\\", "\\\\");
        var rx = new RegExp("^" + symbol + "+|" + symbol + "(?=" + symbol + ")|" + symbol + "$", "gi");
        return line.replace(rx, "");
    }

    ///<summary>gets the first words from a string.</summary>
    pca.getText = function (line) {
        return /[a-zA-Z][a-zA-Z\s]+[a-zA-Z]/.exec(line);
    }

    ///<summary>Gets the first number from a string.</summary>
    pca.getNumber = function (line) {
        return /\d+/.exec(line);
    }

    ///<summary>parse a JSON string if it's safe and return an object.</summary>
    ///<remarks>has a preference for the native parser.</remarks>
    pca.parseJSON = function (text) {
        if (text && (/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                .replace(/(?:^|:|,)(?:\s*\[)+/g, ''))))
            return (typeof JSON != 'undefined' ? JSON.parse(text) : eval(text));

        return {};
    }

    ///<summary>Parse a formatted JSON date.</summary>
    pca.parseJSONDate = function (text) {
        return new Date(parseInt(pca.getNumber(text)));
    }

    ///<summary>Checks if a string contains a word.</summary>
    pca.containsWord = function (text, word) {
        var rx = new RegExp("\\b" + word + "\\b", "gi");
        return rx.test(text);
    }

    ///<summary>Removes a word from a string.</summary>
    pca.removeWord = function (text, word) {
        var rx = new RegExp("\\s?\\b" + word + "\\b", "gi");
        return text.replace(rx, "");
    }

    ///<summary>Merges one objects properties into another</summary>
    pca.merge = function (source, destination) {
        for (var i in source)
            if (!destination[i]) destination[i] = source[i];
    }

    ///<summary>Find a DOM element.</summary>
    pca.getElement = function (reference, base) {
        if (!reference)
            return null;

        if (reference.tagName)
            return reference;

        base = pca.getElement(base) || document;

        if (typeof reference == 'string') {
            var byId = base.getElementById ? base.getElementById(reference) : null;
            if (byId) return byId;

            var byName = base.getElementsByName ? base.getElementsByName(reference) : null;
            if (byName.length) return byName[0];
        }

        return pca.getElementByRegex(reference, base);
    }

    ///<summary>Retrieves a DOM element using RegEx matching on the id.</summary>
    pca.getElementByRegex = function (regex, base) {
        //compile and check regex strings
        if (typeof regex == 'string') {
            try { regex = new RegExp(regex); }
            catch (e) { return null; }
        }

        //make sure its a RegExp
        if (typeof regex == 'object' && regex.constructor == RegExp) {
            base = pca.getElement(base) || document;

            var elements = base.getElementsByTagName("*");

            for (var i = 0; i < elements.length; i++) {
                var elem = elements[i];
                if (elem.id && regex.test(elem.id))
                    return elem;
            }
        }

        return null;
    }

    ///<summary>Get the value of a DOM element.</summary>
    pca.getValue = function (element) {
        if (element = pca.getElement(element)) {
            if (element.tagName == "INPUT" || element.tagName == "TEXTAREA") {
                if (element.type == "checkbox")
                    return element.checked;
                else
                    return element.value;
            }
            if (element.tagName == "SELECT")
                return element.options[element.selectedIndex].value;
            if (element.tagName == "DIV" || element.tagName == "SPAN" || element.tagName == "TD")
                return element.innerHTML;
        }

        return "";
    }

    ///<summary>Set the value of a DOM element.</summary>
    pca.setValue = function (element, value) {
        if ((value || value == '') && (element = pca.getElement(element))) {
            var valueText = value.toString(),
                valueTextLower = valueText.toLowerCase();

            if (element.tagName == "INPUT" || element.tagName == "TEXTAREA") {
                if (element.type == "checkbox")
                    element.checked = ((typeof (value) == "boolean" && value) || valueTextLower == "true");
                else
                    element.value = valueText;
            }
            else if (element.tagName == "SELECT") {
                for (var s = 0; s < element.options.length; s++) {
                    if (element.options[s].value.toLowerCase() == valueTextLower || element.options[s].text.toLowerCase() == valueTextLower) {
                        element.selectedIndex = s;
                        return;
                    }
                }
            }
            else if (element.tagName == "DIV" || element.tagName == "SPAN" || element.tagName == "TD")
                element.innerHTML = valueText.replace(/\n/g, "<br/>");
        }
    }

    ///<summary>Returns true if the element is a text input field.</summary>
    pca.inputField = function (element) {
        if (element = pca.getElement(element))
            return (element.tagName && (element.tagName == "INPUT" || element.tagName == "TEXTAREA") && element.type && (element.type == "text" || element.type == "textarea"));

        return false;
    }

    ///<summary>Returns true if the element is a select list field.</summary>
    pca.selectList = function (element) {
        if (element = pca.getElement(element))
            return (element.tagName && element.tagName == "SELECT");

        return false;
    }

    ///<summary>Returns true if the element is a checkbox.</summary>
    pca.checkBox = function (element) {
        if (element = pca.getElement(element))
            return (element.tagName && element.tagName == "INPUT" && element.type && element.type == "checkbox");

        return false;
    }

    ///<summary>Shortcut to clear the value of a DOM element.</summary>
    pca.clear = function (element) {
        pca.setValue(element, '');
    }

    ///<summary>Get the position of a DOM element.</summary>
    pca.getPosition = function (element) {
        var empty = { left: 0, top: 0 };

        if (element = pca.getElement(element)) {
            if (!element.tagName) return empty;

            if (typeof element.getBoundingClientRect != 'undefined') {
                var bb = element.getBoundingClientRect(),
                    fixed = !isPage(pca.getTopOffsetParent(element)),
                    pageScroll = pca.getScroll(window),
                    parentScroll = pca.getParentScroll(element);
                return { left: bb.left + parentScroll.left + (fixed ? 0 : pageScroll.left), top: bb.top + parentScroll.top + (fixed ? 0 : pageScroll.top) };
            }

            var x = 0, y = 0;

            do {
                x += element.offsetLeft;
                y += element.offsetTop;
            } while (element = element.offsetParent);

            return { left: x, top: y };
        }

        return empty;
    }

    ///<summary>Is the element the document or window.</summary>
    function isPage(element) {
        return element == window || element == document || element == document.body;
    }

    ///<summary>Gets the scroll values from an elements top offset parent.</summary>
    pca.getScroll = function (element) {
        return {
            left: element.scrollX || element.scrollLeft || (isPage(element) ? document.documentElement.scrollLeft || document.body.scrollLeft : 0),
            top: element.scrollY || element.scrollTop || (isPage(element) ? document.documentElement.scrollTop || document.body.scrollTop : 0)
        };
    }

    ///<summary>Get the height and width of a DOM element.</summary>
    pca.getSize = function (element) {
        return {
            height: (element.offsetHeight || element.innerHeight || (isPage(element) ? (document.documentElement.clientHeight || document.body.clientHeight) : 0)),
            width: (element.offsetWidth || element.innerWidth || (isPage(element) ? (document.documentElement.clientWidth || document.body.clientWidth) : 0))
        };
    }

    ///<summary>Get the scroll value for all parent elements.</summary>
    pca.getParentScroll = function (element) {
        var empty = { left: 0, top: 0 };

        if (element = pca.getElement(element)) {
            if (!element.tagName) return empty;
            if (!(element = element.parentNode)) return empty;

            var x = 0, y = 0;

            do {
                if (isPage(element)) break;
                x += element.scrollLeft;
                y += element.scrollTop;
            } while (element = element.parentNode);

            return { left: x, top: y };
        }

        return empty;
    }

    ///<summary>Get the element which an element is positioned relative to.</summary>
    pca.getTopOffsetParent = function (element) {
        while (element.offsetParent) {
            element = element.offsetParent;

            //fix for firefox
            if (pca.getStyle(element, "position") == "fixed")
                break;
        }

        return element;
    }

    ///<summary>Gets the current value of a style property of an element.</summary>
    pca.getStyle = function (element, property) {
        return ((window.getComputedStyle ? window.getComputedStyle(element) : element.currentStyle) || {})[property] || "";
    }

    ///<summary>Adds a CSS class to an element.</summary>
    pca.addClass = function (element, className) {
        if (element = pca.getElement(element)) {
            if (!pca.containsWord(element.className || "", className))
                element.className += (element.className ? " " : "") + className;
        }
    }

    ///<summary>Removes a CSS class from an element.</summary>
    pca.removeClass = function (element, className) {
        if (element = pca.getElement(element))
            element.className = pca.removeWord(element.className, className);
    }

    ///<summary>Applies fixes to a style sheet.</summary>
    ///<param name="selectorText">CSS selector text for the rule as it appears in the stylesheet.</param>
    ///<param name="fixes">An object with javascript style property name and value.</param>
    pca.applyStyleFixes = function (selectorText, fixes) {
        for (var s = 0; s < document.styleSheets.length; s++) {
            var sheet = document.styleSheets[s],
                rules = sheet.rules || sheet.cssRules || []; //possible denial of access if script and css are hosted separately

            for (var r = 0; r < rules.length; r++) {
                var rule = rules[r];

                if (rule.selectorText.toLowerCase() == selectorText) {
                    for (var f in fixes)
                        rule.style[f] = fixes[f];
                }
            }
        }

        pca.styleFixes.push({ selectorText: selectorText, fixes: fixes });
    }

    ///<summary>Reapplies all fixes to style sheets.</summary>
    pca.reapplyStyleFixes = function () {
        var fixesList = pca.styleFixes;

        pca.styleFixes = [];

        for (var i = 0; i < fixesList.length; i++)
            pca.applyStyleFixes(fixesList[i].selectorText, fixesList[i].fixes)
    }

    ///<summary>Creates a stylesheet from cssText.</summary>
    pca.createStyleSheet = function (cssText) {
        if (document.createStyleSheet)
            document.createStyleSheet().cssText = cssText;
        else
            document.head.appendChild(pca.create("style", { type: "text/css", innerHTML: cssText }));
    }

    ///<summary>Simple function to create an element.</summary>
    pca.create = function (tag, properties, cssText) {
        var elem = document.createElement(tag);
        for (var i in properties || {})
            elem[i] = properties[i];
        if (cssText) elem.style.cssText = cssText;
        return elem;
    }

    ///<summary>Listens to an event with standard DOM event handling.</summary>
    pca.listen = function (target, event, action, capture) {
        if (window.addEventListener)
            target.addEventListener(event, action, capture);
        else
            target.attachEvent('on' + event, action);
    }

    ///<summary>Fires a standard DOM event.</summary>
    pca.fire = function (target, event) {
        if (document.createEvent) {
            var e = document.createEvent('HTMLEvents');
            e.initEvent(event, true, true);
            return !target.dispatchEvent(e);
        }
        else
            return target.fireEvent('on' + event, document.createEventObject());
    }

    ///<summary>Removes listeners for an event with standard DOM event handling.</summary>
    pca.ignore = function (target, event, action) {
        if (window.removeEventListener)
            target.removeEventListener(event, action);
        else
            target.detachEvent('on' + event, action);
    }

    ///<summary>Stops other actions of an event.</summary>
    pca.smash = function (event) {
        var e = event || window.event;
        e.stopPropagation ? e.stopPropagation() : e.cancelBubble = true;
        e.preventDefault ? e.preventDefault() : e.returnValue = false;
    }

    ///<summary>Debug messages.</summary>
    ///<remarks>Add a div with an id of "pcadebug" or use the console.</remarks>
    pca.debug = function (message) {
        pca.setValue("pcadebug", message);
        if (console) console.log(message);
    }

    checkDocumentLoad();
})(window);

(function () {
    //namespace
    var pca = window.pca = window.pca || {};

    pca.countries = [
        { iso2: "AF", iso3: "AFG", name: "Afghanistan", flag: 1 },
        { iso2: "AX", iso3: "ALA", name: "Åland Islands", flag: 220 },
        { iso2: "AL", iso3: "ALB", name: "Albania", flag: 2 },
        { iso2: "DZ", iso3: "DZA", name: "Algeria", flag: 3 },
        { iso2: "AS", iso3: "ASM", name: "American Samoa", flag: 4 },
        { iso2: "AD", iso3: "AND", name: "Andorra", flag: 5 },
        { iso2: "AO", iso3: "AGO", name: "Angola", flag: 6 },
        { iso2: "AI", iso3: "AIA", name: "Anguilla", flag: 7 },
        { iso2: "AQ", iso3: "ATA", name: "Antarctica", flag: 0 },
        { iso2: "AG", iso3: "ATG", name: "Antigua and Barbuda", flag: 8 },
        { iso2: "AR", iso3: "ARG", name: "Argentina", flag: 9 },
        { iso2: "AM", iso3: "ARM", name: "Armenia", flag: 10 },
        { iso2: "AW", iso3: "ABW", name: "Aruba", flag: 11 },
        { iso2: "AU", iso3: "AUS", name: "Australia", flag: 12 },
        { iso2: "AT", iso3: "AUT", name: "Austria", flag: 13 },
        { iso2: "AZ", iso3: "AZE", name: "Azerbaijan", flag: 14 },
        { iso2: "BS", iso3: "BHS", name: "Bahamas", flag: 15 },
        { iso2: "BH", iso3: "BHR", name: "Bahrain", flag: 16 },
        { iso2: "BD", iso3: "BGD", name: "Bangladesh", flag: 17 },
        { iso2: "BB", iso3: "BRB", name: "Barbados", flag: 18 },
        { iso2: "BY", iso3: "BLR", name: "Belarus", flag: 19 },
        { iso2: "BE", iso3: "BEL", name: "Belgium", flag: 20 },
        { iso2: "BZ", iso3: "BLZ", name: "Belize", flag: 21 },
        { iso2: "BJ", iso3: "BEN", name: "Benin", flag: 22 },
        { iso2: "BM", iso3: "BMU", name: "Bermuda", flag: 23 },
        { iso2: "BT", iso3: "BTN", name: "Bhutan", flag: 24 },
        { iso2: "BO", iso3: "BOL", name: "Bolivia, Plurinational State Of", flag: 25 },
        { iso2: "BQ", iso3: "BES", name: "Bonaire, Saint Eustatius and Saba", flag: 0 },
        { iso2: "BA", iso3: "BIH", name: "Bosnia and Herzegovina", flag: 26 },
        { iso2: "BW", iso3: "BWA", name: "Botswana", flag: 27 },
        { iso2: "BV", iso3: "BVT", name: "Bouvet Island", flag: 0 },
        { iso2: "BR", iso3: "BRA", name: "Brazil", flag: 28 },
        { iso2: "IO", iso3: "IOT", name: "British Indian Ocean Territory", flag: 29 },
        { iso2: "BN", iso3: "BRN", name: "Brunei Darussalam", flag: 0 },
        { iso2: "BG", iso3: "BGR", name: "Bulgaria", flag: 31 },
        { iso2: "BF", iso3: "BFA", name: "Burkina Faso", flag: 32 },
        { iso2: "BI", iso3: "BDI", name: "Burundi", flag: 34 },
        { iso2: "KH", iso3: "KHM", name: "Cambodia", flag: 35 },
        { iso2: "CM", iso3: "CMR", name: "Cameroon", flag: 36 },
        { iso2: "CA", iso3: "CAN", name: "Canada", flag: 37 },
        { iso2: "CV", iso3: "CPV", name: "Cape Verde", flag: 38 },
        { iso2: "KY", iso3: "CYM", name: "Cayman Islands", flag: 39 },
        { iso2: "CF", iso3: "CAF", name: "Central African Republic", flag: 40 },
        { iso2: "TD", iso3: "TCD", name: "Chad", flag: 41 },
        { iso2: "CL", iso3: "CHL", name: "Chile", flag: 42 },
        { iso2: "CN", iso3: "CHN", name: "China", flag: 43 },
        { iso2: "CX", iso3: "CXR", name: "Christmas Island", flag: 0 },
        { iso2: "CC", iso3: "CCK", name: "Cocos (Keeling) Islands", flag: 0 },
        { iso2: "CO", iso3: "COL", name: "Colombia", flag: 44 },
        { iso2: "KM", iso3: "COM", name: "Comoros", flag: 45 },
        { iso2: "CG", iso3: "COG", name: "Congo", flag: 0 },
        { iso2: "CD", iso3: "COD", name: "Congo, the Democratic Republic of the", flag: 46 },
        { iso2: "CK", iso3: "COK", name: "Cook Islands", flag: 47 },
        { iso2: "CR", iso3: "CRI", name: "Costa Rica", flag: 48 },
        { iso2: "CI", iso3: "CIV", name: "Côte D'ivoire", flag: 49 },
        { iso2: "HR", iso3: "HRV", name: "Croatia", flag: 50 },
        { iso2: "CU", iso3: "CUB", name: "Cuba", flag: 51 },
        { iso2: "CW", iso3: "CUW", name: "Curaçao", flag: 0 },
        { iso2: "CY", iso3: "CYP", name: "Cyprus", flag: 52 },
        { iso2: "CZ", iso3: "CZE", name: "Czech Republic", flag: 53 },
        { iso2: "DK", iso3: "DNK", name: "Denmark", flag: 54 },
        { iso2: "DJ", iso3: "DJI", name: "Djibouti", flag: 55 },
        { iso2: "DM", iso3: "DMA", name: "Dominica", flag: 56 },
        { iso2: "DO", iso3: "DOM", name: "Dominican Republic", flag: 57 },
        { iso2: "EC", iso3: "ECU", name: "Ecuador", flag: 61 },
        { iso2: "EG", iso3: "EGY", name: "Egypt", flag: 58 },
        { iso2: "SV", iso3: "SLV", name: "El Salvador", flag: 59 },
        { iso2: "GQ", iso3: "GNQ", name: "Equatorial Guinea", flag: 62 },
        { iso2: "ER", iso3: "ERI", name: "Eritrea", flag: 63 },
        { iso2: "EE", iso3: "EST", name: "Estonia", flag: 64 },
        { iso2: "ET", iso3: "ETH", name: "Ethiopia", flag: 65 },
        { iso2: "FK", iso3: "FLK", name: "Falkland Islands (Malvinas)", flag: 66 },
        { iso2: "FO", iso3: "FRO", name: "Faroe Islands", flag: 67 },
        { iso2: "FJ", iso3: "FJI", name: "Fiji", flag: 68 },
        { iso2: "FI", iso3: "FIN", name: "Finland", flag: 69 },
        { iso2: "FR", iso3: "FRA", name: "France", flag: 70 },
        { iso2: "GF", iso3: "GUF", name: "French Guiana", flag: 0 },
        { iso2: "PF", iso3: "PYF", name: "French Polynesia", flag: 71 },
        { iso2: "TF", iso3: "ATF", name: "French Southern Territories", flag: 0 },
        { iso2: "GA", iso3: "GAB", name: "Gabon", flag: 72 },
        { iso2: "GM", iso3: "GMB", name: "Gambia", flag: 73 },
        { iso2: "GE", iso3: "GEO", name: "Georgia", flag: 74 },
        { iso2: "DE", iso3: "DEU", name: "Germany", flag: 75 },
        { iso2: "GH", iso3: "GHA", name: "Ghana", flag: 76 },
        { iso2: "GI", iso3: "GIB", name: "Gibraltar", flag: 77 },
        { iso2: "GR", iso3: "GRC", name: "Greece", flag: 79 },
        { iso2: "GL", iso3: "GRL", name: "Greenland", flag: 80 },
        { iso2: "GD", iso3: "GRD", name: "Grenada", flag: 81 },
        { iso2: "GP", iso3: "GLP", name: "Guadeloupe", flag: 0 },
        { iso2: "GU", iso3: "GUM", name: "Guam", flag: 82 },
        { iso2: "GT", iso3: "GTM", name: "Guatemala", flag: 83 },
        { iso2: "GG", iso3: "GGY", name: "Guernsey", flag: 84 },
        { iso2: "GN", iso3: "GIN", name: "Guinea", flag: 85 },
        { iso2: "GW", iso3: "GNB", name: "Guinea-Bissau", flag: 86 },
        { iso2: "GY", iso3: "GUY", name: "Guyana", flag: 87 },
        { iso2: "HT", iso3: "HTI", name: "Haiti", flag: 88 },
        { iso2: "HM", iso3: "HMD", name: "Heard Island and McDonald Islands", flag: 0 },
        { iso2: "VA", iso3: "VAT", name: "Holy See (Vatican City State)", flag: 0 },
        { iso2: "HN", iso3: "HND", name: "Honduras", flag: 89 },
        { iso2: "HK", iso3: "HKG", name: "Hong Kong", flag: 90 },
        { iso2: "HU", iso3: "HUN", name: "Hungary", flag: 91 },
        { iso2: "IS", iso3: "ISL", name: "Iceland", flag: 92 },
        { iso2: "IN", iso3: "IND", name: "India", flag: 93 },
        { iso2: "ID", iso3: "IDN", name: "Indonesia", flag: 94 },
        { iso2: "IR", iso3: "IRN", name: "Iran, Islamic Republic Of", flag: 95 },
        { iso2: "IQ", iso3: "IRQ", name: "Iraq", flag: 96 },
        { iso2: "IE", iso3: "IRL", name: "Ireland", flag: 97 },
        { iso2: "IM", iso3: "IMN", name: "Isle of Man", flag: 98 },
        { iso2: "IL", iso3: "ISR", name: "Israel", flag: 99 },
        { iso2: "IT", iso3: "ITA", name: "Italy", flag: 100 },
        { iso2: "JM", iso3: "JAM", name: "Jamaica", flag: 101 },
        { iso2: "JP", iso3: "JPN", name: "Japan", flag: 102 },
        { iso2: "JE", iso3: "JEY", name: "Jersey", flag: 103 },
        { iso2: "JO", iso3: "JOR", name: "Jordan", flag: 104 },
        { iso2: "KZ", iso3: "KAZ", name: "Kazakhstan", flag: 105 },
        { iso2: "KE", iso3: "KEN", name: "Kenya", flag: 106 },
        { iso2: "KI", iso3: "KIR", name: "Kiribati", flag: 107 },
        { iso2: "KP", iso3: "PRK", name: "Korea, Democratic People's Republic of", flag: 149 },
        { iso2: "KR", iso3: "KOR", name: "Korea, Republic of", flag: 185 },
        { iso2: "KW", iso3: "KWT", name: "Kuwait", flag: 108 },
        { iso2: "KG", iso3: "KGZ", name: "Kyrgyzstan", flag: 109 },
        { iso2: "LA", iso3: "LAO", name: "Lao people's Democratic Republic", flag: 0 },
        { iso2: "LV", iso3: "LVA", name: "Latvia", flag: 110 },
        { iso2: "LB", iso3: "LBN", name: "Lebanon", flag: 111 },
        { iso2: "LS", iso3: "LSO", name: "Lesotho", flag: 112 },
        { iso2: "LR", iso3: "LBR", name: "Liberia", flag: 113 },
        { iso2: "LY", iso3: "LBY", name: "Libya", flag: 114 },
        { iso2: "LI", iso3: "LIE", name: "Liechtenstein", flag: 115 },
        { iso2: "LT", iso3: "LTU", name: "Lithuania", flag: 116 },
        { iso2: "LU", iso3: "LUX", name: "Luxembourg", flag: 117 },
        { iso2: "MO", iso3: "MAC", name: "Macao", flag: 118 },
        { iso2: "MK", iso3: "MKD", name: "Macedonia, the Former Yugoslav Republic of", flag: 119 },
        { iso2: "MG", iso3: "MDG", name: "Madagascar", flag: 120 },
        { iso2: "MW", iso3: "MWI", name: "Malawi", flag: 121 },
        { iso2: "MY", iso3: "MYS", name: "Malaysia", flag: 122 },
        { iso2: "MV", iso3: "MDV", name: "Maldives", flag: 123 },
        { iso2: "ML", iso3: "MLI", name: "Mali", flag: 124 },
        { iso2: "MT", iso3: "MLT", name: "Malta", flag: 125 },
        { iso2: "MH", iso3: "MHL", name: "Marshall Islands", flag: 126 },
        { iso2: "MQ", iso3: "MTQ", name: "Martinique", flag: 127 },
        { iso2: "MR", iso3: "MRT", name: "Mauritania", flag: 128 },
        { iso2: "MU", iso3: "MUS", name: "Mauritius", flag: 129 },
        { iso2: "YT", iso3: "MYT", name: "Mayotte", flag: 0 },
        { iso2: "MX", iso3: "MEX", name: "Mexico", flag: 130 },
        { iso2: "FM", iso3: "FSM", name: "Micronesia, Federated States of", flag: 131 },
        { iso2: "MD", iso3: "MDA", name: "Moldova, Republic of", flag: 132 },
        { iso2: "MC", iso3: "MCO", name: "Monaco", flag: 133 },
        { iso2: "MN", iso3: "MNG", name: "Mongolia", flag: 134 },
        { iso2: "ME", iso3: "MNE", name: "Montenegro", flag: 0 },
        { iso2: "MS", iso3: "MSR", name: "Montserrat", flag: 135 },
        { iso2: "MA", iso3: "MAR", name: "Morocco", flag: 136 },
        { iso2: "MZ", iso3: "MOZ", name: "Mozambique", flag: 137 },
        { iso2: "MM", iso3: "MMR", name: "Myanmar", flag: 33 },
        { iso2: "NA", iso3: "NAM", name: "Namibia", flag: 138 },
        { iso2: "NR", iso3: "NRU", name: "Nauru", flag: 139 },
        { iso2: "NP", iso3: "NPL", name: "Nepal", flag: 140 },
        { iso2: "NL", iso3: "NLD", name: "Netherlands", flag: 141 },
        { iso2: "NC", iso3: "NCL", name: "New Caledonia", flag: 0 },
        { iso2: "NZ", iso3: "NZL", name: "New Zealand", flag: 142 },
        { iso2: "NI", iso3: "NIC", name: "Nicaragua", flag: 143 },
        { iso2: "NE", iso3: "NER", name: "Niger", flag: 144 },
        { iso2: "NG", iso3: "NGA", name: "Nigeria", flag: 145 },
        { iso2: "NU", iso3: "NIU", name: "Niue", flag: 146 },
        { iso2: "NF", iso3: "NFK", name: "Norfolk Island", flag: 147 },
        { iso2: "MP", iso3: "MNP", name: "Northern Mariana Islands", flag: 148 },
        { iso2: "NO", iso3: "NOR", name: "Norway", flag: 150 },
        { iso2: "OM", iso3: "OMN", name: "Oman", flag: 151 },
        { iso2: "PK", iso3: "PAK", name: "Pakistan", flag: 152 },
        { iso2: "PW", iso3: "PLW", name: "Palau", flag: 153 },
        { iso2: "PS", iso3: "PSE", name: "Palestine, State of", flag: 0 },
        { iso2: "PA", iso3: "PAN", name: "Panama", flag: 154 },
        { iso2: "PG", iso3: "PNG", name: "Papua New Guinea", flag: 155 },
        { iso2: "PY", iso3: "PRY", name: "Paraguay", flag: 156 },
        { iso2: "PE", iso3: "PER", name: "Peru", flag: 157 },
        { iso2: "PH", iso3: "PHL", name: "Philippines", flag: 158 },
        { iso2: "PN", iso3: "PCN", name: "Pitcairn", flag: 0 },
        { iso2: "PL", iso3: "POL", name: "Poland", flag: 159 },
        { iso2: "PT", iso3: "PRT", name: "Portugal", flag: 160 },
        { iso2: "PR", iso3: "PRI", name: "Puerto Rico", flag: 161 },
        { iso2: "QA", iso3: "QAT", name: "Qatar", flag: 162 },
        { iso2: "RE", iso3: "REU", name: "Réunion", flag: 0 },
        { iso2: "RO", iso3: "ROU", name: "Romania", flag: 163 },
        { iso2: "RU", iso3: "RUS", name: "Russian Federation", flag: 164 },
        { iso2: "RW", iso3: "RWA", name: "Rwanda", flag: 165 },
        { iso2: "BL", iso3: "BLM", name: "Saint Barthélemy", flag: 0 },
        { iso2: "SH", iso3: "SHN", name: "Saint Helena, Ascension and Tristan da Cunha", flag: 166 },
        { iso2: "KN", iso3: "KNA", name: "Saint Kitts and Nevis", flag: 167 },
        { iso2: "LC", iso3: "LCA", name: "Saint Lucia", flag: 168 },
        { iso2: "MF", iso3: "MAF", name: "Saint Martin (French part)", flag: 0 },
        { iso2: "PM", iso3: "SPM", name: "Saint Pierre and Miquelon", flag: 169 },
        { iso2: "VC", iso3: "VCT", name: "Saint Vincent and the Grenadines", flag: 170 },
        { iso2: "WS", iso3: "WSM", name: "Samoa", flag: 171 },
        { iso2: "SM", iso3: "SMR", name: "San Marino", flag: 172 },
        { iso2: "ST", iso3: "STP", name: "Sao Tome and Principe", flag: 173 },
        { iso2: "SA", iso3: "SAU", name: "Saudi Arabia", flag: 174 },
        { iso2: "SN", iso3: "SEN", name: "Senegal", flag: 175 },
        { iso2: "RS", iso3: "SRB", name: "Serbia", flag: 0 },
        { iso2: "SC", iso3: "SYC", name: "Seychelles", flag: 176 },
        { iso2: "SL", iso3: "SLE", name: "Sierra Leone", flag: 177 },
        { iso2: "SG", iso3: "SGP", name: "Singapore", flag: 178 },
        { iso2: "SX", iso3: "SXM", name: "Sint Maarten (Dutch part)", flag: 0 },
        { iso2: "SK", iso3: "SVK", name: "Slovakia", flag: 179 },
        { iso2: "SI", iso3: "SVN", name: "Slovenia", flag: 180 },
        { iso2: "SB", iso3: "SLB", name: "Solomon Islands", flag: 181 },
        { iso2: "SO", iso3: "SOM", name: "Somalia", flag: 182 },
        { iso2: "ZA", iso3: "ZAF", name: "South Africa", flag: 183 },
        { iso2: "GS", iso3: "SGS", name: "South Georgia and the South Sandwich Islands", flag: 184 },
        { iso2: "SS", iso3: "SSD", name: "South Sudan", flag: 0 },
        { iso2: "ES", iso3: "ESP", name: "Spain", flag: 186 },
        { iso2: "LK", iso3: "LKA", name: "Sri Lanka", flag: 187 },
        { iso2: "SD", iso3: "SDN", name: "Sudan", flag: 188 },
        { iso2: "SR", iso3: "SUR", name: "Suriname", flag: 189 },
        { iso2: "SJ", iso3: "SJM", name: "Svalbard and Jan Mayen", flag: 190 },
        { iso2: "SZ", iso3: "SWZ", name: "Swaziland", flag: 191 },
        { iso2: "SE", iso3: "SWE", name: "Sweden", flag: 192 },
        { iso2: "CH", iso3: "CHE", name: "Switzerland", flag: 193 },
        { iso2: "SY", iso3: "SYR", name: "Syrian Arab Republic", flag: 0 },
        { iso2: "TW", iso3: "TWN", name: "Taiwan, Province Of China", flag: 194 },
        { iso2: "TJ", iso3: "TJK", name: "Tajikistan", flag: 195 },
        { iso2: "TZ", iso3: "TZA", name: "Tanzania, United Republic Of", flag: 196 },
        { iso2: "TH", iso3: "THA", name: "Thailand", flag: 197 },
        { iso2: "TL", iso3: "TLS", name: "Timor-Leste", flag: 0 },
        { iso2: "TG", iso3: "TGO", name: "Togo", flag: 198 },
        { iso2: "TK", iso3: "TKL", name: "Tokelau", flag: 0 },
        { iso2: "TO", iso3: "TON", name: "Tonga", flag: 199 },
        { iso2: "TT", iso3: "TTO", name: "Trinidad and Tobago", flag: 200 },
        { iso2: "TN", iso3: "TUN", name: "Tunisia", flag: 201 },
        { iso2: "TR", iso3: "TUR", name: "Turkey", flag: 202 },
        { iso2: "TM", iso3: "TKM", name: "Turkmenistan", flag: 203 },
        { iso2: "TC", iso3: "TCA", name: "Turks and Caicos Islands", flag: 204 },
        { iso2: "TV", iso3: "TUV", name: "Tuvalu", flag: 205 },
        { iso2: "UG", iso3: "UGA", name: "Uganda", flag: 206 },
        { iso2: "UA", iso3: "UKR", name: "Ukraine", flag: 207 },
        { iso2: "AE", iso3: "ARE", name: "United Arab Emirates", alternates: ["UAE"], flag: 208 },
        { iso2: "GB", iso3: "GBR", name: "United Kingdom", alternates: ["Britain", "England", "Great Britain", "Northern Ireland", "Scotland", "UK", "Wales"], flag: 78 },
        { iso2: "US", iso3: "USA", name: "United States", alternates: ["America", "United States of America"], flag: 210 },
        { iso2: "UM", iso3: "UMI", name: "United States Minor Outlying Islands", flag: 0 },
        { iso2: "UY", iso3: "URY", name: "Uruguay", flag: 209 },
        { iso2: "UZ", iso3: "UZB", name: "Uzbekistan", flag: 211 },
        { iso2: "VU", iso3: "VUT", name: "Vanuatu", flag: 212 },
        { iso2: "VE", iso3: "VEN", name: "Venezuela, Bolivarian Republic Of", flag: 213 },
        { iso2: "VN", iso3: "VNM", name: "Viet Nam", flag: 214 },
        { iso2: "VG", iso3: "VGB", name: "Virgin Islands, British", flag: 30 },
        { iso2: "VI", iso3: "VIR", name: "Virgin Islands, U.S.", flag: 215 },
        { iso2: "WF", iso3: "WLF", name: "Wallis and Futuna", flag: 216 },
        { iso2: "EH", iso3: "ESH", name: "Western Sahara", flag: 0 },
        { iso2: "YE", iso3: "YEM", name: "Yemen", flag: 217 },
        { iso2: "ZM", iso3: "ZMB", name: "Zambia", flag: 218 },
        { iso2: "ZW", iso3: "ZWE", name: "Zimbabwe", flag: 219 }
    ];

    ///<summary>Input field modes.</summary>
    ///<remarks>Bitset values.</remarks>
    pca.countryNameType = {
        NAME: 0,
        ISO2: 1,
        ISO3: 2
    };

    ///<summary>Creates an autocomplete list with country options.</summary>
    pca.CountryList = function (fields, options) {
        var countrylist = new pca.Object(this);

        countrylist.fields = fields || [];
        countrylist.options = options || {};

        countrylist.options.defaultCode = countrylist.options.defaultCode || "";
        countrylist.options.value = countrylist.options.value || "";
        countrylist.options.codesList = countrylist.options.codesList || "";
        countrylist.options.fillOthers = countrylist.options.fillOthers || false;
        countrylist.options.list = countrylist.options.list || {};
        countrylist.options.populate = typeof countrylist.options.populate == 'boolean' ? countrylist.options.populate : true;
        countrylist.options.prepopulate = typeof countrylist.options.prepopulate == 'boolean' ? countrylist.options.prepopulate : true;
        countrylist.options.nameType = countrylist.options.nameType || pca.countryNameType.NAME;
        countrylist.options.valueType = countrylist.options.valueType || pca.countryNameType.ISO3;

        countrylist.template = "<div class='pcaflag'></div><div class='flaglabel'>{name}</div>";
        countrylist.autocomplete = new pca.AutoComplete(countrylist.fields, countrylist.options.list);
        countrylist.country = null;
        countrylist.textChanged = false;

        countrylist.load = function () {
            pca.addClass(countrylist.autocomplete.element, "countrylist");

            //add countries to the list
            if (countrylist.options.codesList) {
                var codesSplit = countrylist.options.codesList.replace(/\s/g, "").split(","),
                    filteredList = [];

                countrylist.autocomplete.clear();

                for (var i = 0; i < codesSplit.length; i++) {
                    var code = codesSplit[i].toString().toUpperCase();

                    for (var c = 0; c < pca.countries.length; c++) {
                        if (pca.countries[c].iso2 == code || pca.countries[c].iso3 == code) {
                            filteredList.push(pca.countries[c]);
                            break;
                        }
                    }
                }

                if (countrylist.options.fillOthers) {
                    for (var o = 0; o < pca.countries.length; o++) {
                        var contains = false;

                        for (var f = 0; f < filteredList.length; f++) {
                            if (pca.countries[o].iso3 == filteredList[f].iso3)
                                contains = true;
                        }

                        if (!contains) filteredList.push(pca.countries[o]);
                    }
                }

                countrylist.autocomplete.clear().add(filteredList, countrylist.template, countrylist.change);
            }
            else countrylist.autocomplete.clear().add(pca.countries, countrylist.template, countrylist.change);

            //set flags and add alternate filter tags to each country
            countrylist.autocomplete.list.collection.all(function (item) {
                countrylist.setFlagPosition(item.element.firstChild, item.data.flag);
                item.tag += " " + pca.formatTag(item.data.iso3 + (item.data.alternates ? " " + item.data.alternates.join(" ") : ""));
            });

            //always show the full list to begin with
            countrylist.autocomplete.listen("focus", function () {
                countrylist.autocomplete.showAll();
            });

            function textChanged(field) {
                countrylist.setCountry(pca.getValue(field));
                countrylist.textChanged = false;
            }

            //automatically set the country when the field value is changed
            countrylist.autocomplete.listen("change", function (field) {
                countrylist.autocomplete.visible ? countrylist.textChanged = true : textChanged(field);
            });

            countrylist.autocomplete.listen("hide", function () {
                if (countrylist.textChanged) textChanged(countrylist.autocomplete.field);
            });

            //set the initial value
            if (countrylist.options.value) countrylist.country = countrylist.find(countrylist.options.value);
            if (!countrylist.country && countrylist.options.defaultCode) countrylist.country = countrylist.find(countrylist.options.defaultCode);
            countrylist.country = countrylist.country || countrylist.first();

            countrylist.fire("load");
        }

        ///<summary>Returns the name of the country with the current nameType option.</summary>
        countrylist.getName = function (country) {
            switch (countrylist.options.nameType) {
                case pca.countryNameType.NAME:
                    return (country || countrylist.country).name;
                case pca.countryNameType.ISO2:
                    return (country || countrylist.country).iso2;
                case pca.countryNameType.ISO3:
                    return (country || countrylist.country).iso3;
            }

            return (country || countrylist.country).name;
        }

        ///<summary>Returns the value of the country with the current valueType option.</summary>
        countrylist.getValue = function (country) {
            switch (countrylist.options.valueType) {
                case pca.countryNameType.NAME:
                    return (country || countrylist.country).name;
                case pca.countryNameType.ISO2:
                    return (country || countrylist.country).iso2;
                case pca.countryNameType.ISO3:
                    return (country || countrylist.country).iso3;
            }

            return (country || countrylist.country).iso3;
        }

        ///<summary>Populates all bound country fields.</summary>
        countrylist.populate = function () {
            if (!countrylist.options.populate) return;

            var name = countrylist.getName(),
                value = countrylist.getValue();

            for (var i = 0; i < countrylist.fields.length; i++) {
                var countryField = pca.getElement(countrylist.fields[i]),
                    currentValue = pca.getValue(countryField);

                pca.setValue(countryField, (pca.selectList(countryField) ? value : name));

                if (countrylist.options.prepopulate && currentValue != pca.getValue(countryField))
                    pca.fire(countryField, "change");
            }

            countrylist.fire("populate");
        }

        ///<summary>Finds a matching country from a name or code.</summary>
        countrylist.find = function (country) {
            country = country.toString().toUpperCase();

            function isAlternate(item) {
                if (item.data.alternates) {
                    for (var a = 0; a < item.data.alternates.length; a++) {
                        if (item.data.alternates[a].toUpperCase() == country)
                            return true;
                    }
                }

                return false;
            }

            return (countrylist.autocomplete.list.collection.first(function (item) {
                return item.data.iso2.toUpperCase() == country || item.data.iso3.toUpperCase() == country || item.data.name.toUpperCase() == country || isAlternate(item);
            }) || {}).data;
        }

        ///<summary>Returns the first country in the list.</summary>
        countrylist.first = function () {
            return countrylist.autocomplete.list.collection.first().data;
        }

        ///<summary>Country is selected.</summary>
        countrylist.change = function (country) {
            if (country) {
                countrylist.country = country;
                countrylist.populate();
                countrylist.textChanged = false;
                countrylist.fire("change", countrylist.country);
            }
        }

        ///<summary>Sets the index of a flag icon element.</summary>
        countrylist.setFlagPosition = function (element, index) {
            element.style.backgroundPosition = "-1px -" + (index * 16 + 2) + "px";
        }

        ///<summary>Creates a dynamic flag icon.</summary>
        countrylist.flag = function () {
            var flag = pca.create("div", { className: "pcaflag" });

            function updateFlag(country) {
                countrylist.setFlagPosition(flag, country.flag);
            }

            updateFlag(countrylist.country);
            countrylist.listen("change", updateFlag);

            return flag;
        }

        ///<summary>Sets the country</summary>
        ///<param name="country">The country name or code to change to.</param>
        countrylist.setCountry = function (country) {
            countrylist.change(countrylist.find(country));
            return countrylist;
        }

        ///<summary>Sets the country based on the current client IP.</summary>
        ///<param name="key">A license key for the request.</param>
        countrylist.setCountryByIP = function (key) {
            function success(response) {
                if (response.length && response[0].Iso3)
                    countrylist.setCountry(response[0].Iso3);
            }

            if (key) pca.fetch("Extras/Web/Ip2Country/v1.10", { Key: key }, success);
        }

        countrylist.load();
    }
})();

(function () {
    //namespace
    var pca = window.pca = window.pca || {};

    ///<summary>Input field modes.</summary>
    ///<remarks>Bitset values.</remarks>
    pca.fieldMode = {
        DEFAULT: 3,
        NONE: 0,
        SEARCH: 1,
        POPULATE: 2,
        PRESERVE: 4,
        COUNTRY: 8
    };

    ///<summary>Address searching component</summary>
    pca.Address = function (fields, options) {
        var address = new pca.Object(this);

        //messages
        address.messages = {
            DIDYOUMEAN: "Did you mean:",
            NORESULTS: "Sorry, no results were found",
            NOADDRESS: "Sorry, we could not find this address",
            SERVICEERROR: "Service Error:",
            COUNTRYSELECT: "Country Select",
            NOLOCATION: "Sorry, we could not get your location"
        };

        address.templates = {
            AUTOCOMPLETE: "{Match}<b>{Suggestion}</b>",
            AUTOCOMPLETEFIND: "<b>{Suggestion}</b>"
        };

        address.fields = fields || [];
        address.options = options || {};
        address.key = address.options.key || "";

        address.options.source = address.options.source || "";
        address.options.application = address.options.application || "";
        address.options.populate = typeof address.options.populate == 'boolean' ? address.options.populate : true;
        address.options.onlyInputs = typeof address.options.onlyInputs == 'boolean' ? address.options.onlyInputs : false;
        address.options.autoSearch = typeof address.options.autoSearch == 'boolean' ? address.options.autoSearch : false;
        address.options.minSearch = address.options.minSearch || 1;
        address.options.maxItems = address.options.maxItems || 0;
        address.options.suppressAutocomplete = typeof address.options.suppressAutocomplete == 'boolean' ? address.options.suppressAutocomplete : false;

        address.options.countries = address.options.countries || {};
        address.options.countries.defaultCode = address.options.countries.defaultCode || "" || "" || "GBR";
        address.options.countries.value = address.options.countries.value || "";
        address.options.countries.prepopulate = typeof address.options.countries.prepopulate == 'boolean' ? address.options.countries.prepopulate : true;
        address.options.list = address.options.list || {};
        address.options.bar = address.options.bar || {};
        address.options.bar.visible = typeof address.options.bar.visible == 'boolean' ? address.options.bar.visible : true;

        address.countryCode = address.options.countries.defaultCode;
        address.first = false;
        address.searchAfterCountry = false;

        address.autocomplete = null;
        address.countrylist = null;

        address.geolocation = null;

        address.load = function () {
            var searchFields = [],
                countryFields = [];

            //create a list of search and country fields
            for (var f = 0; f < address.fields.length; f++) {
                var field = address.fields[f];

                field.mode = field.mode || pca.fieldMode.DEFAULT;

                if (field.mode & pca.fieldMode.COUNTRY)
                    countryFields.push(field.element);
                else if (field.mode & pca.fieldMode.SEARCH)
                    searchFields.push(field.element);

                if (address.options.suppressAutocomplete) {
                    var elem = pca.getElement(field.element);
                    if (elem) elem.autocomplete = "off";
                }
            }

            //create an autocomplete list to display search results
            address.autocomplete = new pca.AutoComplete(searchFields, address.options.list);

            //listen for the user typing something
            address.autocomplete.listen("keyup", function (key) {
                if (key == 0 || key == 8 || key > 36) searchField();
            });

            //show just the bar when a field gets focus
            address.autocomplete.listen("focus", address.focus);

            //listen to blur event for custom code
            address.autocomplete.listen("blur", address.blur);

            //search on double click
            address.autocomplete.listen("dblclick", searchField);

            //if the list says its filtered out some results we need to load more
            address.autocomplete.list.listen("filter", function () {
                address.search(pca.getValue(address.autocomplete.field));
            });

            //if the user hits delete we can't be sure we've done the first search
            address.autocomplete.listen("delete", function () {
                address.first = false;
            });

            //get initial country value
            if (!address.options.countries.value && countryFields.length)
                address.options.countries.value = pca.getValue(countryFields[0]);

            //create a countrylist to change the current country
            address.countrylist = new pca.CountryList(countryFields, address.options.countries);
            address.countryCode = address.countrylist.country.iso3;

            //when the country is changed update the address list
            address.countrylist.listen("change", function (country) {
                address.countryCode = country && country.iso3 ? country.iso3 : address.options.countries.defaultCode;

                if (address.searchAfterCountry) {
                    address.autocomplete.field.focus();
                    searchField();
                }

                address.countrylist.autocomplete.hide();
                address.fire("country", country);
            });

            //if they close the list do not search next time a country is picked
            address.countrylist.autocomplete.listen("hide", function () {
                address.searchAfterCountry = false;
            });

            //create a flag icon and add to the footer of the search list
            var flagbutton = pca.create("div", { className: "flagbutton" }),
                flag = address.countrylist.flag();
            flagbutton.appendChild(flag)
            address.autocomplete.footer.setContent(flagbutton).show();

            //clicking the flag button will show the country list
            pca.listen(flagbutton, "click", address.showCountrylist);

            //create another flag icon on the country list to close it
            var countryFlagbutton = pca.create("div", { className: "flagbutton" }),
                countryFlag = address.countrylist.flag();
            countryFlagbutton.appendChild(countryFlag)
            address.countrylist.autocomplete.footer.setContent(countryFlagbutton);

            //check if search bar is visible
            if (address.options.bar.visible)
                address.countrylist.autocomplete.footer.show();

            //clicking the flag button will hide the country list
            pca.listen(countryFlagbutton, "click", function () {
                if (address.searchAfterCountry) {
                    address.autocomplete.field.focus();
                    searchField();
                };

                address.countrylist.autocomplete.hide();
            });

            //add the country select message to the footer - shown by default
            var message = pca.create("div", { className: "pcamessage disableselect", innerHTML: address.messages.COUNTRYSELECT });
            address.autocomplete.footer.setContent(message);

            //add the logo to the footer - shown with results
            var link = pca.create("a", { href: "http://www.postcodeanywhere.co.uk", target: "_blank" }),
                logo = pca.create("div", { className: "pcalogo" });
            link.appendChild(logo);
            address.autocomplete.footer.setContent(link);

            //switch to the logo
            address.showFooterLogo = function () {
                link.style.display = "";
                message.style.display = "none";
            }

            //switch to the message
            address.showFooterMessage = function () {
                link.style.display = "none";
                message.style.display = "";
            }

            //add the country select message to the country select footer - always shown
            var countryMessage = pca.create("div", { className: "pcamessage disableselect", innerHTML: address.messages.COUNTRYSELECT });
            address.countrylist.autocomplete.footer.setContent(countryMessage);
        }

        //search if needed
        function searchField() {
            var term = pca.getValue(address.autocomplete.field);

            if (term && !address.first && term.length >= address.options.minSearch) {
                address.first = true;
                address.search(term);
            }
        }

        ///<summary>Takes a partial search string and gets matches for it.</summary>
        address.search = function (term) {

            function success(response) {
                if (response.length)
                    address.showresults(response, address.templates.AUTOCOMPLETE);
                else
                    address.message(address.messages.NOADDRESS, true);
            }

            address.fire("search", term);

            if (term)
                pca.fetch("CapturePlus/Interactive/AutoComplete/v2.00", { Key: address.key, Country: address.countryCode, SearchTerm: term, $block: true, $cache: true }, success, address.error);

            return address;
        }

        ///<summary>Searches using the current browser/devices location.</summary>
        ///<remarks>Browser location only supported in HTML5.</remarks>
        address.searchByLocation = function (latitude, longitude) {
            var location = "",
                accuracy = 0;

            //managed to get browser location
            function gotLocation(response) {
                if (response && response.coords) {
                    location = response.coords.latitude + "," + response.coords.longitude;
                    accuracy = response.coords.accuracy;

                    address.geolocation = response.coords;

                    fetchLocation();
                }
                else
                    noLocation();
            }

            function noLocation() {
                address.message(address.messages.NOLOCATION, true);
            }

            //retrieve address results
            function fetchLocation() {
                function success(response) {
                    if (response.length)
                        address.showresults(response, address.templates.AUTOCOMPLETE);
                    else
                        address.message(address.messages.NOADDRESS, true);
                }

                pca.fetch("CapturePlus/Interactive/AutoComplete/v2.00", { Key: address.key, Location: location, LocationAccuracy: accuracy, $block: true, $cache: true }, success, address.error);
            }

            //latitude and longitude could be 0
            if ((latitude || latitude == 0) && (longitude || longitude == 0)) {
                location = latitude + "," + longitude;
                fetchLocation();
            }
            else if (navigator.geolocation)
                navigator.geolocation.getCurrentPosition(gotLocation, noLocation, { enableHighAccuracy: true });
            else
                noLocation();

            return address;
        }

        ///<summary>Looks up a location result when the user selects one.</summary>
        address.lookup = function (id) {

            function success(response) {
                if (response.length)
                    address.showresults(response, address.templates.AUTOCOMPLETEFIND);
                else
                    address.message(address.messages.NOADDRESS, true);
            }

            pca.fetch("CapturePlus/Interactive/AutoCompleteFind/v2.00", { Key: address.key, Id: id }, success, address.error);
        }

        ///<summary>Retrieves an address when the user selects one.</summary>
        address.retrieve = function (id) {

            function success(response) {
                response.length ? address.populate(response) : address.error(address.messages.NOADDRESS);
            }

            pca.fetch("CapturePlus/Interactive/RetrieveById/v2.00", { Key: address.key, Id: id, Application: address.options.application, Source: address.options.source }, success, address.error);
        }

        ///<summary>Handles an error from the service.</summary>
        address.error = function (message) {
            address.fire("error", message);
            throw address.messages.SERVICEERROR + " " + message;
        }

        ///<summary>Show search results in the list.</summary>
        address.showresults = function (results, template) {
            address.autocomplete.clear().add(results, template, address.select).show()
            address.autocomplete.header.hide();
            address.showFooterLogo();
            return address;
        }

        ///<summary>Shows a message in the autocomplete.</summary>
        address.message = function (text, noResults) {
            address.reset();
            address.autocomplete.show();
            address.autocomplete.header.setText(text).show();
            address.showFooterMessage();
            if (noResults) address.autocomplete.clear().list.hide();
            return address;
        }

        ///<summary>User has selected something, either an address or location.</summary>
        address.select = function (suggestion) {
            address.fire("select", suggestion);
            suggestion.IsRetrievable ? address.retrieve(suggestion.Id) : address.lookup(suggestion.Id);
            return address;
        }

        ///<summary>Populate the fields with the address result.</summary>
        address.populate = function (details) {
            details = getAddressObject(details);

            address.autocomplete.hide();

            if (address.options.countries.prepopulate)
                address.countrylist.populate();

            address.fire("prepopulate", details);

            for (var a = 0; a < address.fields.length && address.options.populate; a++) {
                var field = address.fields[a];

                //skip this field if it's not set to be populated
                if (!(field.mode & pca.fieldMode.POPULATE)) continue;

                //skip the field if it's not an input field and the onlyInputs option is set
                if (address.options.onlyInputs && !(pca.inputField(field.element) || pca.selectList(field.element) || pca.checkBox(field.element))) continue;

                //skip this field if it's in preserve mode, already had a value and is not the search field
                if ((field.mode & pca.fieldMode.PRESERVE) && pca.getValue(field.element) && address.autocomplete.field != pca.getElement(field.element)) continue;

                pca.setValue(field.element, details[field.field]);
            }

            address.first = false;
            address.fire("populate", details);
            return address;
        }

        ///<summary>Gets an object representation of the address response</summary>
        function getAddressObject(details) {
            var addressObject = {};

            for (var d = 0; d < details.length; d++) {
                if (details[d].FieldGroup == "Common" || details[d].FieldGroup == "Country")
                    addressObject[details[d].FieldName] = details[d].FormattedValue;
            }

            return addressObject;
        }

        ///<summary>Returns a formatted address line from the address response</summary>
        ///<param name="addressObject">The address as an object</param>
        ///<param name="lineNumber">The required address line number</param>
        ///<param name="lineTotal">The total number of lines required</param>
        ///<param name="separateCompany">Specifies whether to include the company name in the address</param>
        address.getAddressLine = function (details, lineNumber, lineTotal, includeCompany) {
            var lineCount,
                result = "";

            includeCompany = includeCompany && !!details.Company;

            if (includeCompany) {
                if (lineNumber == 1 && lineTotal > 1)
                    return details.Company;

                if (lineNumber == 1 && lineTotal == 1)
                    result = details.Company;
                else {
                    lineNumber--;
                    lineTotal--;
                }
            }

            if (!details.Line1)
                lineCount = 0
            else if (!details.Line2)
                lineCount = 1
            else if (!details.Line3)
                lineCount = 2
            else if (!details.Line4)
                lineCount = 3
            else if (!details.Line5)
                lineCount = 4
            else
                lineCount = 5;

            //work out the current line number and how many address elements should appear on it
            var start = Math.floor(1 + ((lineCount / lineTotal) + ((lineTotal - (lineNumber - 1)) / lineTotal)) * (lineNumber - 1)),
                lines = Math.floor((lineCount / lineTotal) + ((lineTotal - lineNumber) / lineTotal));

            //concatenate the address elements to make the address line
            for (var a = 0; a < lines; a++)
                result += (result ? ", " : "") + (details["Line" + (a + start)] || "");

            return result;
        }

        ///<summary>Switches to the countrylist.</summary>
        address.showCountrylist = function () {
            address.autocomplete.hide();
            address.countrylist.autocomplete.position(address.autocomplete.field);
            address.countrylist.autocomplete.showAll();
            address.countrylist.autocomplete.hover = true;
            address.searchAfterCountry = true;
        }

        ///<summary>Hides the countrylist.</summary>
        address.hideCountrylist = function () {
            address.countrylist.autocomplete.hide();
        }

        ///<summary>Sets the country for searching</summary>
        ///<param name="country">The country name or code to change to.</param>
        address.setCountry = function (country) {
            address.countrylist.setCountry(country);
            return address;
        }

        ///<summary>Sets the country based on the current client IP.</summary>
        address.setCountryByIP = function () {
            address.countrylist.setCountryByIP(address.key);
            return address;
        }

        ///<summary>Clear the address fields.</summary>
        address.clear = function () {
            for (var a = 0; a < address.fields.length; a++)
                pca.setValue(address.fields[a].element, "");

            address.fire("clear");
            return address;
        }

        ///<summary>Address control has focus.</summary>
        address.focus = function () {
            address.reset();

            if (address.options.autoSearch)
                searchField();

            address.fire("focus");
        }

        ///<summary>Address control has lost.</summary>
        address.blur = function () {
            address.fire("blur");
        }

        ///<summary>Reset the control back to it's initial state.</summary>
        address.reset = function () {
            if (address.options.bar.visible) {
                address.autocomplete.list.clear().hide();
                address.autocomplete.header.hide();
                address.showFooterMessage();
            }
            else {
                address.autocomplete.hide();
                address.autocomplete.footer.hide();
            }

            address.first = false;
            return address;
        }

        ///<summary>Disables the address control.</summary>
        address.disable = function () {
            address.autocomplete.disabled = true;
            address.countrylist.autocomplete.disabled = true;
            return address;
        }

        ///<summary>Enables the address control after being disabled.</summary>
        address.enable = function () {
            address.autocomplete.disabled = false;
            address.countrylist.autocomplete.disabled = false;
            return address;
        }

        ///<summary>Perminantly removes the address control elements and event listeners from the page.</summary>
        address.destroy = function () {
            address.autocomplete.destroy();
            address.countrylist.autocomplete.destroy();
            return address;
        }

        //only load when the page is ready
        pca.ready(address.load);
    }
})();