/*
 *	piece_ui.js is responsible for displaying and allowing the user to
 *	manipulate the pieces on the board.  It assumes that there is a
 *	world JavaScript environment defined so that it can register
 *	itself as a producer and listener to world events
 */

/*
 * Make a unique client ID that can be used to ignore update messages
 * that we generated and have already displayed (like moves)
 *
 * TODO: make it truly unique (currently low probability of hitting another client)
 */
var g_client_id = (""+Math.random()).split(".").pop();

function piece_show_action_icons(piece){
	var piece_move = $(piece).find(".piece_move");
	var piece_rotate = $(piece).find(".piece_rotate");
	var piece_face = $(piece).find(".piece_face");
	var position = $(piece_face).offset();
	//    piece_move.position({my: "top left", at: "top left", of: piece_face});
	position.left = piece.offsetLeft + $(piece_face).width() / 2 - $(piece_move).width() - 8;
	position.top = piece.offsetTop + $(piece_face).height() / 2 - $(piece_move).height() / 2;
	$(piece_move).offset(position);
	position.left = piece.offsetLeft + $(piece_face).width() / 2 + 8;
	position.top = piece.offsetTop + $(piece_face).height() / 2 - $(piece_rotate).height() / 2;
	$(piece_rotate).offset(position);
	piece_move.stop(true,true).animate({
		opacity:1
	},200);
	piece_rotate.stop(true,true).animate({
		opacity:1
	},200);
}
	
function piece_hide_action_icons(piece){
	var piece_move = $(piece).find(".piece_move");
	var piece_rotate = $(piece).find(".piece_rotate");
	piece_move.stop(true,true).animate({
		opacity:0
	},200);
	piece_rotate.stop(true,true).animate({
		opacity:0
	},200);
}

function set_piece_location(piece, position){
	var offset = $(piece).offset();
	if ((offset.left != position.left) || (offset.top != position.top)){
		world_move_piece(piece.world_piece_index, g_client_id, 
						 position.left, position.top);
		$(piece).offset(position);
	}
}

/*
 * Handles a mouse down event (single pointer) upon a piece
 * 
 * If a user clicks down upon a piece, we want to be able to do different things
 * depending upon if the user presses and holds (without moving), presses and drags
 * (moving), presses and releases (single click), and possibly double click.
 * 
 * If a user presses and drags, we move the piece
 * If a user presses and holds (0.5 seconds), we rotate the piece
 * If a user presses and releases (a click), we display a context menu
 * (A future possibility is to have double click flip a piece)
 */
function on_piece_mouse_down(event){
	// We do not want regular event processing on a piece mouse down
	event.preventDefault();
	// Record the piece we are manipulating for use in new event handlers we'll define'
	var piece = this;
	// Store where on the piece we clicked (for use with dragging)
	var piece_offset = $(piece).offset();
	var position_on_piece = {
		x: (event.pageX - piece_offset.left),
		y: (event.pageY - piece_offset.top)
	};
	var board = $(document); // The #board object may not extend to the whole area
	$(piece).css("opacity",0.5);
	var drag_function = function (event) {
		event.preventDefault();
		var position = {
			left: event.pageX - position_on_piece.x,
			top: event.pageY - position_on_piece.y
		}
		set_piece_location(piece,position);
		return(false);
	};
	var stop_drag_function = function (event) {
		event.preventDefault();
		$(piece).css("opacity",1);
		board.unbind("mousemove.drag");
		board.unbind("mouseup.drag");
		return(false);
	};
	board.bind("mousemove.drag",drag_function);
	board.bind("mouseup.drag",stop_drag_function);
	return (false);
}

/*
 *  Handle touch event (separate from on_piece_mouse_down in case we 
 *  want to handle multi-touch)
 */
function on_piece_touch_start(event){
	// We do not want regular event processing on a piece mouse down
	event.preventDefault();
	// Record the piece we are manipulating for use in new event handlers we'll define'
	var piece = this;
	// Store where on the piece we first touched (for use with dragging)
	var piece_offset = $(piece).offset();
	var position_on_piece = {
		x: (event.touches[0].pageX - piece_offset.left),
		y: (event.touches[0].pageY - piece_offset.top)
	};
	var board = $(document); // The #board object may not extend to the whole area
	$(piece).css("opacity",0.5);
	var drag_function = function (event) {
		event.preventDefault();
		if (event.touches && (event.touches.length > 0)){
			var position = {
				left: event.touches[0].pageX - position_on_piece.x,
				top: event.touches[0].pageY - position_on_piece.y
			}
			set_piece_location(piece,position);
		}
		return(false);
	};
	var stop_drag_function = function (event) {
		event.preventDefault();
		$(piece).css("opacity",1);
		board.get(0).removeEventListener("touchmove", drag_function, false)
		board.get(0).removeEventListener("touchend",stop_drag_function, false);
		board.get(0).removeEventListener("touchcancel",stop_drag_function, false);
		return(false);
	};
	board.get(0).addEventListener("touchmove",drag_function,false);
	board.get(0).addEventListener("touchend",stop_drag_function,false);
	board.get(0).addEventListener("touchcancel",stop_drag_function,false);
	return (false);
}


function set_piece_orientation(item, degrees){
	var r = "rotate(" + degrees + "deg)";
	$(item).css("transform",r);
	$(item).css("-webkit-transform",r);
	$(item).css("-moz-transform",r);
	$(item).css("-ms-transform",r);
}

function piece_start_rotate(piece, x, y){
	// Initialize the object orientation if not set
	if (!piece.orientation){
		piece.orientation = 0;
	}
	var rotate_orig_orientation = piece.orientation;
	var piece_face = $(piece).find(".piece_face");
	var piece_center = {
		left: piece.offsetLeft + $(piece_face).width()/2,
		top: piece.offsetTop + $(piece_face).height()/2
		};
	var original_position_from_center = {
		x: (x - piece_center.left),
		y: (y - piece_center.top)
	};
	var board = $(document); // The #board object may not extend to the whole area
	var drag_function = function (event) {
		var piece_center = {
			left: piece.offsetLeft + $(piece_face).width()/2,
			top: piece.offsetTop + $(piece_face).height()/2
		};
		var new_position_from_center = {
			x: (event.pageX - piece_center.left),
			y: (event.pageY - piece_center.top)
		};
		if (new_position_from_center.x != 0 || new_position_from_center.y != 0){
			piece.orientation = rotate_orig_orientation
			+ 360.0 * (Math.atan2(new_position_from_center.x,-new_position_from_center.y)
				- Math.atan2(original_position_from_center.x,-original_position_from_center.y))/(2*3.14159);
		}
		piece.orientation = ((Math.round(piece.orientation / 5) * 5) + 360) % 360;
		set_piece_orientation(piece_face,piece.orientation);
	}
	var stop_drag_function = function () {
		board.unbind("mousemove.rotatedrag");
		board.unbind("mouseup.rotatedrag");
	};
	board.bind("mousemove.rotatedrag",drag_function);
	board.bind("mouseup.rotatedrag",stop_drag_function);
}
	
function board_add_piece(img_url){
	world_add_piece([img_url],50,50);
}

function on_new_piece_handler(piece_idx, piece_data){
	var img_url = piece_data.faces[0];
	var x = piece_data.x;
	var y = piece_data.y;
	var new_id = "piece_" + piece_idx;
	var piece = $('<span class="piece" id="' + new_id + 
		'" style="position: absolute; left: ' + x + 'px; top: ' + y + 'px;">' +
		'<img class="piece_face" src="' + img_url + '">' +
		'<img class="piece_move" style="position:absolute; opacity: 0;" src="../images/transform-move.png">' +
		'<img class="piece_rotate" style="position:absolute; opacity: 0;" src="../images/transform-rotate.png">' +
		'</span>');
	// Add to the board
	$("#board").append(piece);
	// Record the piece index
	piece.get(0).world_piece_index = piece_idx;
	// Record that we are not moving the piece
	piece.bind({
//		mouseenter: function() {piece_show_action_icons(this);}, 
//		mouseleave: function() {piece_hide_action_icons(this);},
		mousedown: on_piece_mouse_down,
		contextmenu: function(){return false;}
	});
	// Add mouse click event
	piece.find(".piece_rotate").bind({
		mousedown: function(event) { 
			event.preventDefault();  
			piece_start_rotate(piece.get(0),event.pageX,event.pageY);
			return false; 
		}
	});
	// Add mouse touch event (for mobile devices)
	piece.get(0).addEventListener("touchstart",on_piece_touch_start,false);
	// Set up change handler for piece
	world_on_piece_change_handlers[piece_idx] = function(piece_data){
		if (piece_data === null){
			piece.remove();
		} else if (("x" in piece_data) && ("y" in piece_data)){
			if (!("client" in piece_data) || 
				(piece_data.client != g_client_id)) {
				$(piece).offset({left: piece_data.x, top: piece_data.y});	
			}
		}
	}
}


$(document).ready(function() {
	// Register ourselves in the world
	world_on_new_piece_handler = on_new_piece_handler; 
//	board_add_piece("../images/piece.png");
//	board_add_piece("../images/shape01.png");
});


// TODO: Set up touch version 
/*
function on_piece_mouse_down(piece, x, y){
	var piece_offset = $(piece).offset();
	var position_on_piece = {
		x: (x - piece_offset.left),
		y: (y - piece_offset.top)
	};
	var board = $(document); // The #board object may not extend to the whole area
	var drag_function = function (event) {
		event.preventDefault();
		var pageX = event.pageX;
		var pageY = event.pageY;
		if (event.touches && (event.touches.length > 0)){
			pageX = event.touches[0].pageX;
			pageY = event.touches[0].pageY;
		}
		var position = {
			left: pageX - position_on_piece.x,
			top: pageY - position_on_piece.y
		}
		$(piece).offset(position);
		return(false);
	};
	var stop_drag_function = function (event) {
		event.preventDefault();
		board.unbind("mousemove.drag");
		board.unbind("mouseup.drag");
		board.get(0).removeEventListener("touchmove", drag_function, false)
		board.get(0).removeEventListener("touchend",stop_drag_function, false);
		board.get(0).removeEventListener("touchcancel",stop_drag_function, false);
		return(false);
	};
	board.bind("mousemove.drag",drag_function);
	board.bind("mouseup.drag",stop_drag_function);
	board.get(0).addEventListener("touchmove",drag_function,false);
	board.get(0).addEventListener("touchend",stop_drag_function,false);
	board.get(0).addEventListener("touchcancel",stop_drag_function,false);
	return(false);
}
*/

// TODO: Add touch event listeners
/*
 	piece.get(0).addEventListener("touchstart",function(event){
		event.preventDefault();
		on_piece_mouse_down(piece.get(0),event.touches[0].pageX,event.touches[0].pageY);
		return false;
	},false);
 */

// TODO: Keyboard interactions
/*
	  function board_keypress(event){
		  if ((event.which == 43) || (event.which == 45) || (event.which == 48)){
		  event.preventDefault();
		  if (!this.zoom_level){
			  this.zoom_level = 1;
		  }
		  if (event.which == 45){
			  this.zoom_level = this.zoom_level * 0.9;
		  }
		  if (event.which == 43){
			  this.zoom_level = this.zoom_level / 0.9;
		  }
		  if (event.which == 48){
			  this.zoom_level = 1;
		  }
		  var r = "scale(" + this.zoom_level + ")";
		  $("body").css("transform",r);
		  $("body").css("transform-origin","0% 0%");
		  $("body").css("-webkit-transform",r);
		  $("body").css("-webkit-transform-origin","0% 0%");
		  $("body").css("-moz-transform",r);
		  $("body").css("-moz-transform-origin","0% 0%");
		  $("body").css("-ms-transform",r);
		  $("body").css("-ms-transform-origin","0% 0%");
		  }
	  }
*/
