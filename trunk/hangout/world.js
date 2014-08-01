
/* Once thing we don't really have here is an object representing the model of
 * the world. Right now we let the piece_ui utilize the piece objects that are
 * generated by the DOM to hold all of the model status.  If we start allowing
 * client side zooming, or other interesting changes, this could be a problem.
 * On the other hand, since z-indexing requires special care (to avoid long term
 * holes), we'd have to pick up that responsibility.
 * 
 * Another interesting issue is that we have specialized functions for moving,
 * locking, etc.  Moving was split out so that we could send multiple close 
 * move commands, and allow the resulting ajax not pile up.  Instead we could
 * replace almost all of these functions with a general world_piece_model_update
 * or even a world_model_update function that could take an array of the changes
 * and act accordingly.
 */

// Keep track of the largest index we use for a piece with the server
var world_max_piece_index = -1;

// For now, use the local PHP server to share world data
var world_server_url = "../server/world.php";

// Hold the current local state
var world_local_state = {};

// Allow cross-domain requests in Ajax
$.support.cors = true;

/*
 * world_get_new_piece_index - Gets the index of the next piece to be added
 * to the world.
 * 
 * TODO: LOW -  There is a small race condition if two pieces are added simultaneously
 * TODO: LOW - Fill in any null holes from previously deleted pieces first
 */
function world_get_new_piece_index(){
	world_max_piece_index ++;
	return world_max_piece_index;
}

/*
 * world_add_piece - Adds a piece to the world server
 * 
 * @param piece_data Object containing new piece data
 */
function world_add_piece(piece_data){
	var piece_index = world_get_new_piece_index();
	world_update_piece(piece_index,piece_data);
}

/*
 * flatten_recursive_structure - This takes a structured recursive array/object
 * and turns it into a single associative array (using "|" to separate
 * keys) suitable for use in Google Hangout state
 * 
 * @param update The update to the world
 * @param base_key (defaults to "") used for recursion
 * @param flat_update (defaults to {}) used for recursion
 */
function flatten_recursive_structure(update, base_key, flat_update){
	base_key = (typeof base_key !== 'undefined') ? base_key : "";
	flat_update = (typeof flat_update !== 'undefined') ? flat_update : {};

	if ($.isArray(update) || $.isPlainObject(update)){
		$.each(update, function(k, e){
			var new_key = base_key ? (base_key + "|" + k) : k;
			if ($.isArray(e) || $.isPlainObject(e)){
				flatten_recursive_structure(e, new_key, flat_update);
			} else {
				if ((e == null) || (e == undefined)){
					flat_update[new_key] = "_NULL_";
				} else {
					flat_update[new_key] = e.toString();
				}
			}
		});
	}
	return (flat_update);
}

/*
 * unflatten_recursive_structure - This a flattened associative array
 * and returns it to a structured recursive array/object.
 * 
 * @param flat_update The flattened update
 */
function unflatten_recursive_structure(flat_update){
	var update = {};

	function compoundkey_set(u, k, v){
		k = k.split("|");
		var f = k.shift();
		while (k.length > 0){
			if (!(u[f] instanceof Object)){
				// Create object for parent of not there
				u[f] = {};
			}
			u = u[f];
			f = k.shift();
		}
		if (v == "_NULL_"){
			u[f] = null;
		} else {
			u[f] = v;
		}
	}

	// TODO: IMMEDIATE - SLOW DOWN rotate
	// TODO: IMMEDIATE - Check Lock and other booleans for string conversion problems
	// TODO: MEDIUM - Move Split Code and Split on pieces if possible
	// TODO: LOW - Move Split Code really high, time, and pool updates by piece
	// TODO: DETERMINE IF WE REALLY NEED TO SORT KEYS IF WE ASSUME EVERYTHING IS AN OBJECT
	// Grab the keys
	var keys = [];
	$.each(flat_update, function(k, v){
		keys.push(k);
	});
	// Now sort the keys
	keys.sort();
	// Now loop through the keys and setting the update object (so we hit parents before children)
	$.each(keys, function(i, k){
		compoundkey_set(update, k, flat_update[k]);
	});
	return (update);
}

/*
 * find_deletions - This takes the flat updates, looks for _NULL_, and if found
 * locates all of the keys currently in the world to remove
 * 
 * @param flat_update The current flat update
 */
function find_deletions(flat_update){
	var deletions = [];
	$.each(flat_update, function(k, e){
		var child_prefix = k + "|";
		if (e == "_NULL_"){ // We found a deletion
			$.each(world_local_state, function(ck,ce){
				if ((ck.indexOf(child_prefix) == 0)){ // We found a child
					deletions.push(ck);
				}
			});
		}
	});
	return (deletions);
}

/* world_queue_update - Queues an update to be sent.  If we've done an update in the 
 * in the recent past, we delay the sending of another to avoid hitting Google Hangout's
 * throttle
 */
function world_queue_update(updates,deletes){
	if (!("queue" in world_queue_update)){
		world_queue_update.queue = [];
		world_queue_update.last_time = 0;
	}
	var next_update = {"u": updates,"d": deletes};
	world_queue_update.queue.push(next_update);
	if (!("loop_running" in world_queue_update)){
		world_queue_update.loop_running = true;
		var call_next_update = function(){
			// Immediately call the next item and record timing
			var n = world_queue_update.queue.shift();
			gapi.hangout.data.submitDelta(n["u"],n["d"]);
			world_queue_update.last_time = new Date().getTime();
			if (world_queue_update.queue.length > 0){
				setTimeout(call_next_update,50);
			} else {
				// Out of requests so stop
				delete world_queue_update.loop_running;
			}
		}
		var now = new Date().getTime();
		if ((now - world_queue_update.last_time) < 50){
			// If we last updated recently, wait a little
			setTimeout(call_next_update,100 - (now - world_queue_update.last_time));
		} else {
			// Else start now
			call_next_update();
		}
	}
}

/*
 * world_update - Sends an update array to the world.  Any subsequent calls will be 
 * combined into a single update until the previous ajax call is completed.
 * 
 * @param update The update to implement in the world
 */
function world_update(update){
	var flat_updates = flatten_recursive_structure(update);
	var flat_deletions = find_deletions(flat_updates);
	// Special case: deleting the world
	if (update === 0){
		// Increment the new count
		var new_count = 1;
		if ("__new" in world_local_state){
			new_count = Number(world_local_state["__new"] + 1);
		}
		flat_updates = {"__new": new_count.toString()};
		// Remove all keys
		flat_deletions = [];
		$.each(world_local_state, function(k,e){
			if (k != "__new"){
				flat_deletions.push(k);
			}
		});
	}
	// If our update is too big (more than 2048 characters), split it up
	if ((JSON.stringify(flat_updates).length + JSON.stringify(flat_deletions).length) < 2048){
//		console.log(JSON.stringify(update));
//		console.log(JSON.stringify(flat_updates));
//		console.log(JSON.stringify(flat_deletions));
		world_queue_update(flat_updates,flat_deletions);
	} else {
		var update_keys = [];
		var inc_updates = {}, inc_deletions = [];
		var k, l = 0;
		// TODO: Note, if we split a piece on an update, that could cause problems...
		// Gather up all update keys
		$.each(flat_updates,function(k,v){
			update_keys.push(k);
		});
// console.log(JSON.stringify(update_keys));
		// Pull off 15 keys of each type to update
		while ((update_keys.length > 0) || (flat_deletions.length > 0)){
			if (update_keys.length > 0){
				k = update_keys.pop();
				inc_updates[k] = flat_updates[k];
				l++;
			}
			if (flat_deletions.length > 0){
				inc_deletions.push(flat_deletions.pop());
			}
			// Send in packs of 15
			if ((l > 14) || (inc_deletions.length > 14)){
				world_queue_update(inc_updates,inc_deletions);
				inc_updates = {};
				l = 0;
				inc_deletions = [];
			}
		}
		// Send any left
		if ((l > 0) || (inc_deletions.length > 0)){
			gapi.hangout.data.submitDelta(inc_updates,inc_deletions);
		}
	}
}

/*
 * world_update_piece - Convenience function to update a piece given a piece
 * index and an array of attributes
 * 
 * @param piece_index Index of the peice to update
 * @param piece_update Object containing the attributes to update 
 */
function world_update_piece(piece_index, piece_update){
	var update = {
		"pieces": new Object()
	};
	update.pieces[piece_index] = piece_update;
	world_update(update);
}

/*
 * world_update_piece_accumulate - Accumulates piece updates until
 * world_update_piece_accumulate_flush is called.  This is useful for easily
 * updating many pieces at once.  Changes to the same piece will
 * completely overwrite old ones.
 * ***NOTE*** FOR HANGOUT WE CAN'T ACCUMULATE TOO MUCH, SO WE INTENTIONALLY BREAK THIS
 * 
 * @param piece_index Index of the peice to update
 * @param piece_update Object containing the attributes to update 
 */
function world_update_piece_accumulate(piece_index, piece_update){
	if (!("update" in world_update_piece_accumulate)){
		world_update_piece_accumulate.update = {
			"pieces": new Object()
		};
	}
	world_update_piece_accumulate.update.pieces[piece_index] = piece_update;
	world_update(world_update_piece_accumulate.update);
	delete world_update_piece_accumulate.update;
}

/*
 * world_update_piece_accumulate_flush - Sends any accumulated piece updates
 * gathered in world_update_piece_accumulate() to the server.
 * ***NOTE*** FOR HANGOUT WE CAN'T ACCUMULATE TOO MUCH, SO WE INTENTIONALLY BREAK THIS
 */
function world_update_piece_accumulate_flush(){
}

/*
 * world_load_from_data - Loads the world from a data object (read from
 * a file)
 * 
 * @param data The ABG data file
 * @param clear_world Boolean if we should replace the current world
 */
function world_load_from_data(data, clear_world){
	// Set the index for our next piece
	var next_piece_index = (world_max_piece_index + 1);
	// Clear the world
	if (clear_world) {
		world_update(0);
		next_piece_index = 0;
	}
	// Cycle through pieces and add them
	if ("pieces" in data){
		$.each(data["pieces"],function(i,p){
			// Convert face data to JSON
			if ("faces" in p){
				p["faces_array"] = JSON.stringify(p["faces"]);
				delete p["faces"];
			}
			// Make sure it appears
			p["client_id"] = -1;
			world_update_piece(next_piece_index,p);
			next_piece_index++;
		});
	} else {
		alert('Sorry, but the URL you provided did not contain any pieces');
	}
	
}

/*
 * world_load_from_url - Uses Ajax to read the contents of an ABG file
 * and either adds it or replaces the current world to it
 * 
 * @param url The URL for the Word
 * @param clear_world Boolean if we should replace the current world
 */
function world_load_from_url(url, clear_world){
	var world_load_failure = function(data, textStatus, errorThrown){
		alert("Sorry, we were unable to read the board game data.  (Please note that loading a board from a URL is not supported in IE9.)")
	}
	var world_load_handler = function(data){
		try {
			data = JSON.parse(data);
		} catch (x) {
			alert('The provided URL does not contain valid board game data.');
			return;
		}
		world_load_from_data(data, clear_world);
	}
	$.ajax({
		url: url,
        success: world_load_handler,
        error: world_load_failure,
        dataType: "text"
	});
}

/*
 * world_load_from_file - Uses FileReader to read the contents of an ABG file
 * and either adds it or replaces the current world to it
 * 
 * @param file The file object
 * @param clear_world Boolean if we should replace the current world
 */
function world_load_from_file(file, clear_world){
	if (window.FileReader === undefined){
		alert("Sorry, but your browser does not support client-side file reading. " +
			"Please consider getting the latest version of Chrome or Firefox");
	}
	var file_reader = new FileReader();
	file_reader.onError = function(){
		alert("Sorry, we were unable to read the file.")
	}
	file_reader.onload = function(evt){
		var data;
		try {
			data = JSON.parse(evt.target.result);
		} catch (x) {
			alert('The provided file does not contain valid board game data.');
			return;
		}
		world_load_from_data(data, clear_world);
	}
	file_reader.readAsText(file);
}

/* world_save_world - Saves the current world to a file (in a new window)
 */
function world_save_world(){
	var pieces = [];
	$.each(g_pieces,function(i,piece){ // Note g_pieces is in piece_ui.js
		var offset = util_page_to_board_coord($(piece).offset());
		pieces.push({
			"faces": piece.faces, // Note: for download we keep the array as is (not JSON)
			"face_width": piece.face_width,
			"x": (offset.left), 
			"y": (offset.top),
			"z": piece.z,
			"lock": piece.lock,
			"shield": piece.shield,
			"orientation": piece.orientation,
			"face_showing": piece.face_showing,
			"css_class": piece.css_class,
			"event_callback": piece.event_callback,
			"custom_html": escape(piece.custom_html)
		});
	});
	var world = { "_new":1, "pieces": pieces};

	try {
		window.open('data:text/json;filename=board.abg,' + 
					encodeURIComponent(JSON.stringify(world)),
					'board.abg');
	} catch (x) {
		alert("Sorry, we are unable to save the board.  (Please note that saving board state is not supported in IE9.)");
	}
}

/*
 * world_on_new_piece_handler - This is a handler function(piece_index, piece_data)
 * that is set by the code interested in listening to piece additions to the world
 * When a new piece is added, the piece_index is set to the index used by the world
 * to reference changes (the index for the change handler in 
 * world_on_piece_change_handlers) and piece_data is an array holding any changed
 * data for the piece.
 */
var world_on_new_piece_handler = function(){};

/*
 *  world_on_piece_change_handlers - This is an array of change handlers 
 *  function(piece_data) that is set by the code interested in listening
 *  to piece changes.  The array is indexed by the piece_index (see
 *  world_on_new_piece_handler).
 */
var world_on_piece_change_handlers = {};

function execute_world_update(update){
	var piece_index;
	// Handle a new world
	if ((!(update instanceof Object)) || ("__new" in update)) {
		// Reset max piece index
		world_max_piece_index = -1;
		// Delete existing pieces
		for (piece_index in world_on_piece_change_handlers){
			world_on_piece_change_handlers[piece_index](null);
			// Unregister the handler
			delete world_on_piece_change_handlers[piece_index];
		}
		// Now add new pieces
		if ((update instanceof Object) && ("pieces" in update)){
			for (piece_index in update.pieces) {
				if (Number(piece_index) > world_max_piece_index){
					world_max_piece_index = Number(piece_index);
				}
				// Add the piece if it isn't null
				if (update.pieces[piece_index] instanceof Object){
					world_on_new_piece_handler(piece_index, update.pieces[piece_index]);
				}
			}
		}
	} else if ("pieces" in update) {
		// Iterate pieces, looking for new, updates, or deletes
		for (piece_index in update.pieces) {
			if ((update.pieces[piece_index] instanceof Object) && 
				(!(Number(piece_index) in world_on_piece_change_handlers))) {
				if (Number(piece_index) > world_max_piece_index){
					world_max_piece_index = Number(piece_index);
				}
				world_on_new_piece_handler(piece_index, update.pieces[piece_index]);
			} else if (piece_index in world_on_piece_change_handlers){
				world_on_piece_change_handlers[piece_index](update.pieces[piece_index]);
				// Check if the piece was deleted
				if (update.pieces[piece_index] === null){
					// Unregister the handler
					delete world_on_piece_change_handlers[piece_index];
				}
			}
		}
	}
}

/*
 * world_listener_start - Implements an loop that checks for updates from
 * the world server.  It calls "execute_world_update" if there is an update.
 */
function world_listener_start(){
	// When the state is updated, this handles the update data
	var world_update_handler = function(eventObj){
		var flat_update = {};
		var i, k, v;
		for (i = 0; i < eventObj.addedKeys.length; ++i){
			k = eventObj.addedKeys[i].key;
			v = eventObj.addedKeys[i].value;
			flat_update[k] = v;
			world_local_state[k] = v;
		}
		for (i = 0; i < eventObj.removedKeys.length; ++i){
			k = eventObj.removedKeys[i].key;
			delete world_local_state[k];
		}
		var update = unflatten_recursive_structure(flat_update);
//		console.log(JSON.stringify(update));
		execute_world_update(update);
	}
	// Get the initial state
	world_local_state = gapi.hangout.data.getState();
	if (world_local_state){
		var update = unflatten_recursive_structure(world_local_state);
//		console.log(JSON.stringify(update));
		execute_world_update(update);
		// See if the world is empty
		if (!("pieces" in update)){
			// See if data was passed in
			var appData = gadgets.views.getParams()['appData'];
			if (appData){
				world_load_from_url(appData,1);
			} else {
				world_load_from_url('http://www.anywhereboardgames.com/hangout/intro.abg',1);
			}
		}
	}
	// Register our update andler
	gapi.hangout.data.onStateChanged.add(world_update_handler);
}

// Start the world listener
gapi.hangout.onApiReady.add(function(eventObj){
  try {
    if (eventObj.isApiReady){
      world_listener_start();	  
    }
  } catch (x) {
	alert("Sorry... there was a problem initializing the board.  Please reload the application (and make sure you are using an updated version of your browser). ")
  }
});