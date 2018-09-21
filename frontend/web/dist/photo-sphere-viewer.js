/*!
 * Photo Sphere Viewer 3.4.0
 * Copyright (c) 2014-2015 Jérémy Heleine
 * Copyright (c) 2015-2018 Damien "Mistic" Sorel
 * Licensed under MIT (https://opensource.org/licenses/MIT)
 */
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['three', 'd.js', 'uevent', 'dot/doT'], factory);
  }
  else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('three'), require('d.js'), require('uevent'), require('dot/doT'));
  }
  else {
    root.PhotoSphereViewer = factory(root.THREE, root.D, root.uEvent, root.doT);
  }
}(this, function(THREE, D, uEvent, doT) {
"use strict";

/**
 * @typedef {Object} PhotoSphereViewer.Point
 * @summary Object defining a point
 * @property {int} x
 * @property {int} y
 */

/**
 * @typedef {Object} PhotoSphereViewer.Size
 * @summary Object defining a size
 * @property {int} width
 * @property {int} height
 */

/**
 * @typedef {Object} PhotoSphereViewer.CssSize
 * @summary Object defining a size in CSS (px, % or auto)
 * @property {string} [width]
 * @property {string} [height]
 */

/**
 * @typedef {Object} PhotoSphereViewer.Position
 * @summary Object defining a spherical position
 * @property {float} longitude
 * @property {float} latitude
 */

/**
 * @typedef {PhotoSphereViewer.Position} PhotoSphereViewer.ExtendedPosition
 * @summary Object defining a spherical or texture position
 * @description A position that can be expressed either in spherical coordinates (radians or degrees) or in texture coordinates (pixels)
 * @property {float} longitude
 * @property {float} latitude
 * @property {int} x
 * @property {int} y
 */

/**
 * @typedef {Object} PhotoSphereViewer.CacheItem
 * @summary An entry in the memory cache
 * @property {string} panorama
 * @property {THREE.Texture} image
 * @property {PhotoSphereViewer.PanoData} pano_data
 */

/**
 * @typedef {Object} PhotoSphereViewer.PanoData
 * @summary Crop information of the panorama
 * @property {int} full_width
 * @property {int} full_height
 * @property {int} cropped_width
 * @property {int} cropped_height
 * @property {int} cropped_x
 * @property {int} cropped_y
 */

/**
 * @typedef {Object} PhotoSphereViewer.ClickData
 * @summary Data of the `click` event
 * @property {int} client_x - position in the browser window
 * @property {int} client_y - position in the browser window
 * @property {int} viewer_x - position in the viewer
 * @property {int} viewer_y - position in the viewer
 * @property {float} longitude - position in spherical coordinates
 * @property {float} latitude - position in spherical coordinates
 * @property {int} texture_x - position on the texture
 * @property {int} texture_y - position on the texture
 * @property {PSVMarker} [marker] - clicked marker
 */

/**
 * Viewer class
 * @param {Object} options - see {@link http://photo-sphere-viewer.js.org/#options}
 * @constructor
 * @fires PhotoSphereViewer.ready
 * @throws {PSVError} when the configuration is incorrect
 */
function PhotoSphereViewer(options) {
  // return instance if called as a function
  if (!(this instanceof PhotoSphereViewer)) {
    return new PhotoSphereViewer(options);
  }

  // init global system variables
  if (!PhotoSphereViewer.SYSTEM.loaded) {
    PhotoSphereViewer._loadSystem();
  }

  /**
   * @summary Configuration object
   * @member {Object}
   * @readonly
   */
  this.config = PSVUtils.clone(PhotoSphereViewer.DEFAULTS);
  PSVUtils.deepmerge(this.config, options);

  // check container
  if (!options.container) {
    throw new PSVError('No value given for container.');
  }

  // must support canvas
  if (!PhotoSphereViewer.SYSTEM.isCanvasSupported) {
    throw new PSVError('Canvas is not supported.');
  }

  // additional scripts if webgl not supported/disabled
  if ((!PhotoSphereViewer.SYSTEM.isWebGLSupported || !this.config.webgl) && !PSVUtils.checkTHREE('CanvasRenderer', 'Projector')) {
    throw new PSVError('Missing Three.js components: CanvasRenderer, Projector. Get them from three.js-examples package.');
  }

  // longitude range must have two values
  if (this.config.longitude_range && this.config.longitude_range.length !== 2) {
    this.config.longitude_range = null;
    console.warn('PhotoSphereViewer: longitude_range must have exactly two elements.');
  }

  if (this.config.latitude_range) {
    // latitude range must have two values
    if (this.config.latitude_range.length !== 2) {
      this.config.latitude_range = null;
      console.warn('PhotoSphereViewer: latitude_range must have exactly two elements.');
    }
    // latitude range must be ordered
    else if (this.config.latitude_range[0] > this.config.latitude_range[1]) {
      this.config.latitude_range = [this.config.latitude_range[1], this.config.latitude_range[0]];
      console.warn('PhotoSphereViewer: latitude_range values must be ordered.');
    }
  }
  // migrate legacy tilt_up_max and tilt_down_max
  else if (this.config.tilt_up_max !== undefined || this.config.tilt_down_max !== undefined) {
    this.config.latitude_range = [
      this.config.tilt_down_max !== undefined ? this.config.tilt_down_max - Math.PI / 4 : -PSVUtils.HalfPI,
      this.config.tilt_up_max !== undefined ? this.config.tilt_up_max + Math.PI / 4 : PSVUtils.HalfPI
    ];
    console.warn('PhotoSphereViewer: tilt_up_max and tilt_down_max are deprecated, use latitude_range instead.');
  }

  // min_fov and max_fov must be ordered
  if (this.config.max_fov < this.config.min_fov) {
    var temp_fov = this.config.max_fov;
    this.config.max_fov = this.config.min_fov;
    this.config.min_fov = temp_fov;
    console.warn('PhotoSphereViewer: max_fov cannot be lower than min_fov.');
  }

  if (this.config.cache_texture && (!PSVUtils.isInteger(this.config.cache_texture) || this.config.cache_texture < 0)) {
    this.config.cache_texture = PhotoSphereViewer.DEFAULTS.cache_texture;
    console.warn('PhotoSphereViewer: invalid value for cache_texture');
  }

  if ('panorama_roll' in this.config) {
    this.config.sphere_correction.roll = this.config.panorama_roll;
    console.warn('PhotoSphereViewer: panorama_roll is deprecated, use sphere_correction.roll instead');
  }

  if ('gyroscope' in this.config) {
    console.warn('PhotoSphereViewer: gyroscope is deprecated, the control is automatically created if DeviceOrientationControls.js is loaded');
  }

  // min_fov/max_fov between 1 and 179
  this.config.min_fov = PSVUtils.bound(this.config.min_fov, 1, 179);
  this.config.max_fov = PSVUtils.bound(this.config.max_fov, 1, 179);

  // default default_fov is middle point between min_fov and max_fov
  if (this.config.default_fov === null) {
    this.config.default_fov = this.config.max_fov / 2 + this.config.min_fov / 2;
  }
  // default_fov between min_fov and max_fov
  else {
    this.config.default_fov = PSVUtils.bound(this.config.default_fov, this.config.min_fov, this.config.max_fov);
  }

  // parse default_long, is between 0 and 2*PI
  this.config.default_long = PSVUtils.parseAngle(this.config.default_long);

  // parse default_lat, is between -PI/2 and PI/2
  this.config.default_lat = PSVUtils.parseAngle(this.config.default_lat, true);

  // parse camera_correction, is between -PI/2 and PI/2
  this.config.sphere_correction.pan = PSVUtils.parseAngle(this.config.sphere_correction.pan, true);
  this.config.sphere_correction.tilt = PSVUtils.parseAngle(this.config.sphere_correction.tilt, true);
  this.config.sphere_correction.roll = PSVUtils.parseAngle(this.config.sphere_correction.roll, true);

  // default anim_lat is default_lat
  if (this.config.anim_lat === null) {
    this.config.anim_lat = this.config.default_lat;
  }
  // parse anim_lat, is between -PI/2 and PI/2
  else {
    this.config.anim_lat = PSVUtils.parseAngle(this.config.anim_lat, true);
  }

  // parse longitude_range, between 0 and 2*PI
  if (this.config.longitude_range) {
    this.config.longitude_range = this.config.longitude_range.map(function(angle) {
      return PSVUtils.parseAngle(angle);
    });
  }

  // parse latitude_range, between -PI/2 and PI/2
  if (this.config.latitude_range) {
    this.config.latitude_range = this.config.latitude_range.map(function(angle) {
      return PSVUtils.parseAngle(angle, true);
    });
  }

  // parse anim_speed
  this.config.anim_speed = PSVUtils.parseSpeed(this.config.anim_speed);

  // reactivate the navbar if the caption is provided
  if (this.config.caption && !this.config.navbar) {
    this.config.navbar = ['caption'];
  }

  // translate boolean fisheye to amount
  if (this.config.fisheye === true) {
    this.config.fisheye = 1;
  }
  else if (this.config.fisheye === false) {
    this.config.fisheye = 0;
  }

  /**
   * @summary Top most parent
   * @member {HTMLElement}
   * @readonly
   */
  this.parent = (typeof options.container === 'string') ? document.getElementById(options.container) : options.container;

  /**
   * @summary Main container
   * @member {HTMLElement}
   * @readonly
   */
  this.container = null;

  /**
   * @member {module:components.PSVLoader}
   * @readonly
   */
  this.loader = null;

  /**
   * @member {module:components.PSVNavBar}
   * @readonly
   */
  this.navbar = null;

  /**
   * @member {module:components.PSVHUD}
   * @readonly
   */
  this.hud = null;

  /**
   * @member {module:components.PSVPanel}
   * @readonly
   */
  this.panel = null;

  /**
   * @member {module:components.PSVTooltip}
   * @readonly
   */
  this.tooltip = null;

  /**
   * @member {module:components.PSVNotification}
   * @readonly
   */
  this.notification = null;

  /**
   * @member {module:components.PSVPleaseRotate}
   * @readonly
   */
  this.pleaseRotate = null;

  /**
   * @member {HTMLElement}
   * @readonly
   * @private
   */
  this.canvas_container = null;

  /**
   * @member {THREE.WebGLRenderer | THREE.CanvasRenderer}
   * @readonly
   * @private
   */
  this.renderer = null;

  /**
   * @member {THREE.StereoEffect}
   * @private
   */
  this.stereoEffect = null;

  /**
   * @member {NoSleep}
   * @private
   */
  this.noSleep = null;

  /**
   * @member {THREE.Scene}
   * @readonly
   * @private
   */
  this.scene = null;

  /**
   * @member {THREE.PerspectiveCamera}
   * @readonly
   * @private
   */
  this.camera = null;

  /**
   * @member {THREE.Mesh}
   * @readonly
   * @private
   */
  this.mesh = null;

  /**
   * @member {THREE.Raycaster}
   * @readonly
   * @private
   */
  this.raycaster = null;

  /**
   * @member {THREE.DeviceOrientationControls}
   * @readonly
   * @private
   */
  this.doControls = null;

  /**
   * @summary Internal properties
   * @member {Object}
   * @readonly
   * @property {boolean} needsUpdate - if the view needs to be renderer
   * @property {boolean} isCubemap - if the panorama is a cubemap
   * @property {PhotoSphereViewer.Position} position - current direction of the camera
   * @property {THREE.Vector3} direction - direction of the camera
   * @property {float} anim_speed - parsed animation speed (rad/sec)
   * @property {int} zoom_lvl - current zoom level
   * @property {float} vFov - vertical FOV
   * @property {float} hFov - horizontal FOV
   * @property {float} aspect - viewer aspect ratio
   * @property {float} move_speed - move speed (computed with pixel ratio and configuration move_speed)
   * @property {boolean} moving - is the user moving
   * @property {boolean} zooming - is the user zooming
   * @property {int} start_mouse_x - start x position of the click/touch
   * @property {int} start_mouse_y - start y position of the click/touch
   * @property {int} mouse_x - current x position of the cursor
   * @property {int} mouse_y - current y position of the cursor
   * @property {Array[]} mouse_history - list of latest positions of the cursor, [time, x, y]
   * @property {int} gyro_alpha_offset - current alpha offset for gyroscope controls
   * @property {int} pinch_dist - distance between fingers when zooming
   * @property main_reqid - animationRequest id of the main event loop
   * @property {function} orientation_cb - update callback of the device orientation
   * @property {function} autorotate_cb - update callback of the automatic rotation
   * @property {Promise} animation_promise - promise of the current animation (either go to position or image transition)
   * @property {Promise} loading_promise - promise of the setPanorama method
   * @property start_timeout - timeout id of the automatic rotation delay
   * @property {PhotoSphereViewer.ClickData} dblclick_data - temporary storage of click data between two clicks
   * @property dblclick_timeout - timeout id for double click
   * @property {PhotoSphereViewer.CacheItem[]} cache - cached panoramas
   * @property {PhotoSphereViewer.Size} size - size of the container
   * @property {PhotoSphereViewer.PanoData} pano_data - panorama metadata
   */
  this.prop = {
    needsUpdate: true,
    isCubemap: undefined,
    position: {
      longitude: 0,
      latitude: 0
    },
    ready: false,
    direction: null,
    anim_speed: 0,
    zoom_lvl: 0,
    vFov: 0,
    hFov: 0,
    aspect: 0,
    move_speed: 0.1,
    moving: false,
    zooming: false,
    start_mouse_x: 0,
    start_mouse_y: 0,
    mouse_x: 0,
    mouse_y: 0,
    mouse_history: [],
    gyro_alpha_offset: 0,
    pinch_dist: 0,
    main_reqid: null,
    orientation_cb: null,
    autorotate_cb: null,
    animation_promise: null,
    loading_promise: null,
    start_timeout: null,
    dblclick_data: null,
    dblclick_timeout: null,
    cache: [],
    size: {
      width: 0,
      height: 0
    },
    pano_data: {
      full_width: 0,
      full_height: 0,
      cropped_width: 0,
      cropped_height: 0,
      cropped_x: 0,
      cropped_y: 0
    }
  };

  // init templates
  Object.keys(PhotoSphereViewer.TEMPLATES).forEach(function(tpl) {
    if (!this.config.templates[tpl]) {
      this.config.templates[tpl] = PhotoSphereViewer.TEMPLATES[tpl];
    }
    if (typeof this.config.templates[tpl] === 'string') {
      this.config.templates[tpl] = doT.template(this.config.templates[tpl]);
    }
  }, this);

  // init
  this.parent.photoSphereViewer = this;

  // create actual container
  this.container = document.createElement('div');
  this.container.classList.add('psv-container');
  this.parent.appendChild(this.container);

  // apply container size
  if (this.config.size !== null) {
    this._setViewerSize(this.config.size);
  }
  this._onResize();

  // apply default zoom level
  var tempZoom = Math.round((this.config.default_fov - this.config.min_fov) / (this.config.max_fov - this.config.min_fov) * 100);
  this.zoom(tempZoom - 2 * (tempZoom - 50));

  // actual move speed depends on pixel-ratio
  this.prop.move_speed = THREE.Math.degToRad(this.config.move_speed / PhotoSphereViewer.SYSTEM.pixelRatio);

  // set default position
  this.rotate({
    longitude: this.config.default_long,
    latitude: this.config.default_lat
  });

  // load loader (!!)
  this.loader = new PSVLoader(this);
  this.loader.hide();

  // load navbar
  this.navbar = new PSVNavBar(this);
  this.navbar.hide();

  // load hud
  this.hud = new PSVHUD(this);
  this.hud.hide();

  // load side panel
  this.panel = new PSVPanel(this);

  // load hud tooltip
  this.tooltip = new PSVTooltip(this.hud);

  // load notification
  this.notification = new PSVNotification(this);

  // attach event handlers
  this._bindEvents();

  // load panorama
  if (this.config.panorama) {
    this.setPanorama(this.config.panorama);
  }

  // enable GUI after first render
  this.once('render', function() {
    if (this.config.navbar) {
      this.container.classList.add('psv-container--has-navbar');
      this.navbar.show();
    }

    this.hud.show();

    if (this.config.markers) {
      this.config.markers.forEach(function(marker) {
        this.hud.addMarker(marker, false);
      }, this);

      this.hud.renderMarkers();
    }

    // Queue animation
    if (this.config.time_anim !== false) {
      this.prop.start_timeout = window.setTimeout(this.startAutorotate.bind(this), this.config.time_anim);
    }

    setTimeout(function() {
      // start render loop
      this._run();

      /**
       * @event ready
       * @memberof PhotoSphereViewer
       * @summary Triggered when the panorama image has been loaded and the viewer is ready to perform the first render
       */
      this.trigger('ready');
    }.bind(this), 0);
  }.bind(this));

  PhotoSphereViewer.SYSTEM.touchEnabled.then(function() {
    this.container.classList.add('psv-is-touch');
  }.bind(this));
}

/**
 * @summary Triggers an event on the viewer
 * @function trigger
 * @memberof PhotoSphereViewer
 * @instance
 * @param {string} name
 * @param {...*} [arguments]
 * @returns {uEvent.Event}
 */

/**
 * @summary Triggers an event on the viewer and returns the modified value
 * @function change
 * @memberof PhotoSphereViewer
 * @instance
 * @param {string} name
 * @param {*} value
 * @param {...*} [arguments]
 * @returns {*}
 */

/**
 * @summary Attaches an event listener on the viewer
 * @function on
 * @memberof PhotoSphereViewer
 * @instance
 * @param {string|Object.<string, function>} name - event name or events map
 * @param {function} [callback]
 * @returns {PhotoSphereViewer}
 */

/**
 * @summary Removes an event listener from the viewer
 * @function off
 * @memberof PhotoSphereViewer
 * @instance
 * @param {string|Object.<string, function>} name - event name or events map
 * @param {function} [callback]
 * @returns {PhotoSphereViewer}
 */

/**
 * @summary Attaches an event listener called once on the viewer
 * @function once
 * @memberof PhotoSphereViewer
 * @instance
 * @param {string|Object.<string, function>} name - event name or events map
 * @param {function} [callback]
 * @returns {PhotoSphereViewer}
 */

uEvent.mixin(PhotoSphereViewer);


/**
 * @summary Main event loop, calls {@link PhotoSphereViewer._render} if `prop.needsUpdate` is true
 * @param {int} timestamp
 * @fires PhotoSphereViewer.filter:before-render
 * @private
 */
PhotoSphereViewer.prototype._run = function(timestamp) {
  /**
   * @event before-render
   * @memberof PhotoSphereViewer
   * @summary Triggered before a render, used to modify the view
   * @param {int} timestamp - time provided by requestAnimationFrame
   */
  this.trigger('before-render', timestamp || +new Date());

  if (this.prop.needsUpdate) {
    this._render();
    this.prop.needsUpdate = false;
  }

  this.prop.main_reqid = window.requestAnimationFrame(this._run.bind(this));
};

/**
 * @summary Performs a render
 * @fires PhotoSphereViewer.render
 * @private
 */
PhotoSphereViewer.prototype._render = function() {
  this.prop.direction = this.sphericalCoordsToVector3(this.prop.position);
  this.camera.position.set(0, 0, 0);
  this.camera.lookAt(this.prop.direction);

  if (this.config.fisheye) {
    this.camera.position.copy(this.prop.direction).multiplyScalar(this.config.fisheye / 2).negate();
  }

  this.camera.aspect = this.prop.aspect;
  this.camera.fov = this.prop.vFov;
  this.camera.updateProjectionMatrix();

  (this.stereoEffect || this.renderer).render(this.scene, this.camera);

  /**
   * @event render
   * @memberof PhotoSphereViewer
   * @summary Triggered on each viewer render, **this event is triggered very often**
   */
  this.trigger('render');
};

/**
 * @summary Loads the XMP data with AJAX
 * @param {string} panorama
 * @returns {Promise.<PhotoSphereViewer.PanoData>}
 * @throws {PSVError} when the image cannot be loaded
 * @private
 */
PhotoSphereViewer.prototype._loadXMP = function(panorama) {
  if (!this.config.usexmpdata) {
    return D.resolved(null);
  }

  var defer = D();
  var xhr = new XMLHttpRequest();
  if (this.config.with_credentials) {
    xhr.withCredentials = true;
  }
  var progress = 0;

  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 200 || xhr.status === 201 || xhr.status === 202 || xhr.status === 0) {
        this.loader.setProgress(100);

        var binary = xhr.responseText;
        var a = binary.indexOf('<x:xmpmeta'), b = binary.indexOf('</x:xmpmeta>');
        var data = binary.substring(a, b);

        // No data retrieved
        if (a === -1 || b === -1 || data.indexOf('GPano:') === -1) {
          defer.resolve(null);
        }
        else {
          var pano_data = {
            full_width: parseInt(PSVUtils.getXMPValue(data, 'FullPanoWidthPixels')),
            full_height: parseInt(PSVUtils.getXMPValue(data, 'FullPanoHeightPixels')),
            cropped_width: parseInt(PSVUtils.getXMPValue(data, 'CroppedAreaImageWidthPixels')),
            cropped_height: parseInt(PSVUtils.getXMPValue(data, 'CroppedAreaImageHeightPixels')),
            cropped_x: parseInt(PSVUtils.getXMPValue(data, 'CroppedAreaLeftPixels')),
            cropped_y: parseInt(PSVUtils.getXMPValue(data, 'CroppedAreaTopPixels'))
          };

          if (!pano_data.full_width || !pano_data.full_height || !pano_data.cropped_width || !pano_data.cropped_height) {
            console.warn('PhotoSphereViewer: invalid XMP data');
            defer.resolve(null);
          }
          else {
            defer.resolve(pano_data);
          }
        }
      }
      else {
        this.container.textContent = 'Cannot load image';
        throw new PSVError('Cannot load image');
      }
    }
    else if (xhr.readyState === 3) {
      this.loader.setProgress(progress += 10);
    }
  }.bind(this);

  xhr.onprogress = function(e) {
    if (e.lengthComputable) {
      var new_progress = parseInt(e.loaded / e.total * 100);
      if (new_progress > progress) {
        progress = new_progress;
        this.loader.setProgress(progress);
      }
    }
  }.bind(this);

  xhr.onerror = function() {
    this.container.textContent = 'Cannot load image';
    throw new PSVError('Cannot load image');
  }.bind(this);

  xhr.open('GET', panorama, true);
  xhr.send(null);

  return defer.promise;
};

/**
 * @summary Loads the panorama texture(s)
 * @param {string|string[]} panorama
 * @returns {Promise.<THREE.Texture|THREE.Texture[]>}
 * @fires PhotoSphereViewer.panorama-load-progress
 * @throws {PSVError} when the image cannot be loaded
 * @private
 */
PhotoSphereViewer.prototype._loadTexture = function(panorama) {
  var tempPanorama = [];

  if (Array.isArray(panorama)) {
    if (panorama.length !== 6) {
      throw new PSVError('Must provide exactly 6 image paths when using cubemap.');
    }

    // reorder images
    for (var i = 0; i < 6; i++) {
      tempPanorama[i] = panorama[PhotoSphereViewer.CUBE_MAP[i]];
    }
    panorama = tempPanorama;
  }
  else if (typeof panorama === 'object') {
    if (!PhotoSphereViewer.CUBE_HASHMAP.every(function(side) {
        return !!panorama[side];
      })) {
      throw new PSVError('Must provide exactly left, front, right, back, top, bottom when using cubemap.');
    }

    // transform into array
    PhotoSphereViewer.CUBE_HASHMAP.forEach(function(side, i) {
      tempPanorama[i] = panorama[side];
    });
    panorama = tempPanorama;
  }

  if (Array.isArray(panorama)) {
    if (this.prop.isCubemap === false) {
      throw new PSVError('The viewer was initialized with an equirectangular panorama, cannot switch to cubemap.');
    }

    if (this.config.fisheye) {
      console.warn('PhotoSphereViewer: fisheye effect with cubemap texture can generate distorsions.');
    }

    if (this.config.cache_texture === PhotoSphereViewer.DEFAULTS.cache_texture) {
      this.config.cache_texture *= 6;
    }

    this.prop.isCubemap = true;

    return this._loadCubemapTexture(panorama);
  }
  else {
    if (this.prop.isCubemap === true) {
      throw new PSVError('The viewer was initialized with an cubemap, cannot switch to equirectangular panorama.');
    }

    this.prop.isCubemap = false;

    return this._loadEquirectangularTexture(panorama);
  }
};

/**
 * @summary Loads the sphere texture
 * @param {string} panorama
 * @returns {Promise.<THREE.Texture>}
 * @fires PhotoSphereViewer.panorama-load-progress
 * @throws {PSVError} when the image cannot be loaded
 * @private
 */
PhotoSphereViewer.prototype._loadEquirectangularTexture = function(panorama) {
  if (this.config.cache_texture) {
    var cache = this.getPanoramaCache(panorama);

    if (cache) {
      this.prop.pano_data = cache.pano_data;

      return D.resolved(cache.image);
    }
  }

  return this._loadXMP(panorama).then(function(pano_data) {
    var defer = D();
    var loader = new THREE.ImageLoader();
    var progress = pano_data ? 100 : 0;

    if (this.config.with_credentials) {
      loader.setCrossOrigin('use-credentials');
    }
    else {
      loader.setCrossOrigin('anonymous');
    }

    var onload = function(img) {
      progress = 100;

      this.loader.setProgress(progress);

      /**
       * @event panorama-load-progress
       * @memberof PhotoSphereViewer
       * @summary Triggered while a panorama image is loading
       * @param {string} panorama
       * @param {int} progress
       */
      this.trigger('panorama-load-progress', panorama, progress);

      // Config XMP data
      if (!pano_data && this.config.pano_data) {
        pano_data = PSVUtils.clone(this.config.pano_data);
      }

      // Default XMP data
      if (!pano_data) {
        pano_data = {
          full_width: img.width,
          full_height: img.height,
          cropped_width: img.width,
          cropped_height: img.height,
          cropped_x: 0,
          cropped_y: 0
        };
      }

      this.prop.pano_data = pano_data;

      var texture;

      var ratio = Math.min(pano_data.full_width, PhotoSphereViewer.SYSTEM.maxTextureWidth) / pano_data.full_width;

      // resize image / fill cropped parts with black
      if (ratio !== 1 || pano_data.cropped_width !== pano_data.full_width || pano_data.cropped_height !== pano_data.full_height) {
        var resized_pano_data = PSVUtils.clone(pano_data);

        resized_pano_data.full_width *= ratio;
        resized_pano_data.full_height *= ratio;
        resized_pano_data.cropped_width *= ratio;
        resized_pano_data.cropped_height *= ratio;
        resized_pano_data.cropped_x *= ratio;
        resized_pano_data.cropped_y *= ratio;

        img.width = resized_pano_data.cropped_width;
        img.height = resized_pano_data.cropped_height;

        var buffer = document.createElement('canvas');
        buffer.width = resized_pano_data.full_width;
        buffer.height = resized_pano_data.full_height;

        var ctx = buffer.getContext('2d');
        ctx.drawImage(img, resized_pano_data.cropped_x, resized_pano_data.cropped_y, resized_pano_data.cropped_width, resized_pano_data.cropped_height);

        texture = new THREE.Texture(buffer);
      }
      else {
        texture = new THREE.Texture(img);
      }

      texture.needsUpdate = true;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      if (this.config.cache_texture) {
        this._putPanoramaCache({
          panorama: panorama,
          image: texture,
          pano_data: pano_data
        });
      }

      defer.resolve(texture);
    };

    var onprogress = function(e) {
      if (e.lengthComputable) {
        var new_progress = parseInt(e.loaded / e.total * 100);

        if (new_progress > progress) {
          progress = new_progress;
          this.loader.setProgress(progress);
          this.trigger('panorama-load-progress', panorama, progress);
        }
      }
    };

    var onerror = function(e) {
      this.container.textContent = 'Cannot load image';
      defer.reject(e);
      throw new PSVError('Cannot load image');
    };

    loader.load(panorama, onload.bind(this), onprogress.bind(this), onerror.bind(this));

    return defer.promise;
  }.bind(this));
};

/**
 * @summary Load the six textures of the cube
 * @param {string[]} panorama
 * @returns {Promise.<THREE.Texture[]>}
 * @fires PhotoSphereViewer.panorama-load-progress
 * @throws {PSVError} when the image cannot be loaded
 * @private
 */
PhotoSphereViewer.prototype._loadCubemapTexture = function(panorama) {
  var defer = D();
  var loader = new THREE.ImageLoader();
  var progress = [0, 0, 0, 0, 0, 0];
  var loaded = [];
  var done = 0;

  if (this.config.with_credentials) {
    loader.setCrossOrigin('use-credentials');
  }
  else {
    loader.setCrossOrigin('anonymous');
  }

  var onend = function() {
    loaded.forEach(function(img) {
      img.needsUpdate = true;
      img.minFilter = THREE.LinearFilter;
      img.generateMipmaps = false;
    });

    defer.resolve(loaded);
  };

  var onload = function(i, img) {
    done++;
    progress[i] = 100;

    this.loader.setProgress(PSVUtils.sum(progress) / 6);
    this.trigger('panorama-load-progress', panorama[i], progress[i]);

    var ratio = Math.min(img.width, PhotoSphereViewer.SYSTEM.maxTextureWidth / 2) / img.width;

    // resize image
    if (ratio !== 1) {
      var buffer = document.createElement('canvas');
      buffer.width = img.width * ratio;
      buffer.height = img.height * ratio;

      var ctx = buffer.getContext('2d');
      ctx.drawImage(img, 0, 0, buffer.width, buffer.height);

      loaded[i] = new THREE.Texture(buffer);
    }
    else {
      loaded[i] = new THREE.Texture(img);
    }

    if (this.config.cache_texture) {
      this._putPanoramaCache({
        panorama: panorama[i],
        image: loaded[i]
      });
    }

    if (done === 6) {
      onend();
    }
  };

  var onprogress = function(i, e) {
    if (e.lengthComputable) {
      var new_progress = parseInt(e.loaded / e.total * 100);

      if (new_progress > progress[i]) {
        progress[i] = new_progress;
        this.loader.setProgress(PSVUtils.sum(progress) / 6);
        this.trigger('panorama-load-progress', panorama[i], progress[i]);
      }
    }
  };

  var onerror = function(i, e) {
    this.container.textContent = 'Cannot load image';
    defer.reject(e);
    throw new PSVError('Cannot load image ' + i);
  };

  for (var i = 0; i < 6; i++) {
    if (this.config.cache_texture) {
      var cache = this.getPanoramaCache(panorama[i]);

      if (cache) {
        done++;
        progress[i] = 100;
        loaded[i] = cache.image;
        continue;
      }
    }

    loader.load(panorama[i], onload.bind(this, i), onprogress.bind(this, i), onerror.bind(this, i));
  }

  if (done === 6) {
    defer.resolve(loaded);
  }

  return defer.promise;
};

/**
 * @summary Applies the texture to the scene, creates the scene if needed
 * @param {THREE.Texture|THREE.Texture[]} texture
 * @fires PhotoSphereViewer.panorama-loaded
 * @private
 */
PhotoSphereViewer.prototype._setTexture = function(texture) {
  if (!this.scene) {
    this._createScene();
  }

  if (this.prop.isCubemap) {
    for (var i = 0; i < 6; i++) {
      if (this.mesh.material[i].map) {
        this.mesh.material[i].map.dispose();
      }

      this.mesh.material[i].map = texture[i];
    }
  }
  else {
    if (this.mesh.material.map) {
      this.mesh.material.map.dispose();
    }

    this.mesh.material.map = texture;
  }

  /**
   * @event panorama-loaded
   * @memberof PhotoSphereViewer
   * @summary Triggered when a panorama image has been loaded
   */
  this.trigger('panorama-loaded');

  this._render();
};

/**
 * @summary Creates the 3D scene and GUI components
 * @private
 */
PhotoSphereViewer.prototype._createScene = function() {
  this.raycaster = new THREE.Raycaster();

  this.renderer = PhotoSphereViewer.SYSTEM.isWebGLSupported && this.config.webgl ? new THREE.WebGLRenderer() : new THREE.CanvasRenderer();
  this.renderer.setSize(this.prop.size.width, this.prop.size.height);
  this.renderer.setPixelRatio(PhotoSphereViewer.SYSTEM.pixelRatio);

  var cameraDistance = PhotoSphereViewer.SPHERE_RADIUS;
  if (this.prop.isCubemap) {
    cameraDistance *= Math.sqrt(3);
  }
  if (this.config.fisheye) {
    cameraDistance += PhotoSphereViewer.SPHERE_RADIUS;
  }

  this.camera = new THREE.PerspectiveCamera(this.config.default_fov, this.prop.size.width / this.prop.size.height, 1, cameraDistance);
  this.camera.position.set(0, 0, 0);

  this.scene = new THREE.Scene();
  this.scene.add(this.camera);

  if (this.prop.isCubemap) {
    this.mesh = this._createCubemap();
  }
  else {
    this.mesh = this._createSphere();
  }

  this.scene.add(this.mesh);

  // create canvas container
  this.canvas_container = document.createElement('div');
  this.canvas_container.className = 'psv-canvas-container';
  this.renderer.domElement.className = 'psv-canvas';
  this.container.appendChild(this.canvas_container);
  this.canvas_container.appendChild(this.renderer.domElement);
};

/**
 * @summary Creates the sphere mesh
 * @param {number} [scale=1]
 * @returns {THREE.Mesh}
 * @private
 */
PhotoSphereViewer.prototype._createSphere = function(scale) {
  scale = scale || 1;

  // The middle of the panorama is placed at longitude=0
  var geometry = new THREE.SphereGeometry(
    PhotoSphereViewer.SPHERE_RADIUS * scale,
    PhotoSphereViewer.SPHERE_VERTICES,
    PhotoSphereViewer.SPHERE_VERTICES,
    -PSVUtils.HalfPI
  );

  var material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, // needs to be DoubleSide for CanvasRenderer
    overdraw: PhotoSphereViewer.SYSTEM.isWebGLSupported && this.config.webgl ? 0 : 1
  });

  var mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = -1;
  mesh.rotation.x = this.config.sphere_correction.tilt;
  mesh.rotation.y = this.config.sphere_correction.pan;
  mesh.rotation.z = this.config.sphere_correction.roll;

  return mesh;
};

/**
 * @summary Creates the cube mesh
 * @param {number} [scale=1]
 * @returns {THREE.Mesh}
 * @private
 */
PhotoSphereViewer.prototype._createCubemap = function(scale) {
  scale = scale || 1;

  var geometry = new THREE.BoxGeometry(
    PhotoSphereViewer.SPHERE_RADIUS * 2 * scale, PhotoSphereViewer.SPHERE_RADIUS * 2 * scale, PhotoSphereViewer.SPHERE_RADIUS * 2 * scale,
    PhotoSphereViewer.CUBE_VERTICES, PhotoSphereViewer.CUBE_VERTICES, PhotoSphereViewer.CUBE_VERTICES
  );

  var materials = [];
  for (var i = 0; i < 6; i++) {
    materials.push(new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      overdraw: PhotoSphereViewer.SYSTEM.isWebGLSupported && this.config.webgl ? 0 : 1
    }));
  }

  var mesh = new THREE.Mesh(geometry, materials);
  mesh.position.x -= PhotoSphereViewer.SPHERE_RADIUS * scale;
  mesh.position.y -= PhotoSphereViewer.SPHERE_RADIUS * scale;
  mesh.position.z -= PhotoSphereViewer.SPHERE_RADIUS * scale;
  mesh.applyMatrix(new THREE.Matrix4().makeScale(1, 1, -1));

  return mesh;
};

/**
 * @summary Performs transition between the current and a new texture
 * @param {THREE.Texture} texture
 * @param {PhotoSphereViewer.Position} [position]
 * @returns {Promise}
 * @private
 * @throws {PSVError} if the panorama is a cubemap
 */
PhotoSphereViewer.prototype._transition = function(texture, position) {
  var mesh;

  if (this.prop.isCubemap) {
    if (position) {
      console.warn('PhotoSphereViewer: cannot perform cubemap transition to different position.');
      position = undefined;
    }

    mesh = this._createCubemap(0.9);

    mesh.material.forEach(function(material, i) {
      material.map = texture[i];
      material.transparent = true;
      material.opacity = 0;
    });
  }
  else {
    mesh = this._createSphere(0.9);

    mesh.material.map = texture;
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
  }

  // rotate the new sphere to make the target position face the camera
  if (position) {
    // Longitude rotation along the vertical axis
    mesh.rotateY(position.longitude - this.prop.position.longitude);

    // Latitude rotation along the camera horizontal axis
    var axis = new THREE.Vector3(0, 1, 0).cross(this.camera.getWorldDirection()).normalize();
    var q = new THREE.Quaternion().setFromAxisAngle(axis, position.latitude - this.prop.position.latitude);
    mesh.quaternion.multiplyQuaternions(q, mesh.quaternion);

    // FIXME: find a better way to handle ranges
    if (this.config.latitude_range || this.config.longitude_range) {
      this.config.longitude_range = this.config.latitude_range = null;
      console.warn('PhotoSphereViewer: trying to perform transition with longitude_range and/or latitude_range, ranges cleared.');
    }
  }

  this.scene.add(mesh);
  this.needsUpdate();

  return PSVUtils.animation({
    properties: {
      opacity: { start: 0.0, end: 1.0 }
    },
    duration: this.config.transition.duration,
    easing: 'outCubic',
    onTick: function(properties) {
      if (this.prop.isCubemap) {
        for (var i = 0; i < 6; i++) {
          mesh.material[i].opacity = properties.opacity;
        }
      }
      else {
        mesh.material.opacity = properties.opacity;
      }

      this.needsUpdate();
    }.bind(this)
  })
    .then(function() {
      // remove temp sphere and transfer the texture to the main sphere
      this._setTexture(texture);
      this.scene.remove(mesh);

      mesh.geometry.dispose();
      mesh.geometry = null;

      // actually rotate the camera
      if (position) {
        this.rotate(position);
      }
    }.bind(this));
};

/**
 * @summary Reverses autorotate direction with smooth transition
 * @private
 */
PhotoSphereViewer.prototype._reverseAutorotate = function() {
  var self = this;
  var newSpeed = -this.config.anim_speed;
  var range = this.config.longitude_range;
  this.config.longitude_range = null;

  PSVUtils.animation({
    properties: {
      speed: { start: this.config.anim_speed, end: 0 }
    },
    duration: 300,
    easing: 'inSine',
    onTick: function(properties) {
      self.config.anim_speed = properties.speed;
    }
  })
    .then(function() {
      return PSVUtils.animation({
        properties: {
          speed: { start: 0, end: newSpeed }
        },
        duration: 300,
        easing: 'outSine',
        onTick: function(properties) {
          self.config.anim_speed = properties.speed;
        }
      });
    })
    .then(function() {
      self.config.longitude_range = range;
      self.config.anim_speed = newSpeed;
    });
};

/**
 * @summary Adds a panorama to the cache
 * @param {PhotoSphereViewer.CacheItem} cache
 * @fires PhotoSphereViewer.panorama-cached
 * @throws {PSVError} when the cache is disabled
 * @private
 */
PhotoSphereViewer.prototype._putPanoramaCache = function(cache) {
  if (!this.config.cache_texture) {
    throw new PSVError('Cannot add panorama to cache, cache_texture is disabled');
  }

  var existingCache = this.getPanoramaCache(cache.panorama);

  if (existingCache) {
    existingCache.image = cache.image;
    existingCache.pano_data = cache.pano_data;
  }
  else {
    this.prop.cache = this.prop.cache.slice(0, this.config.cache_texture - 1); // remove most ancient elements
    this.prop.cache.unshift(cache);
  }

  /**
   * @event panorama-cached
   * @memberof PhotoSphereViewer
   * @summary Triggered when a panorama is stored in the cache
   * @param {string} panorama
   */
  this.trigger('panorama-cached', cache.panorama);
};

/**
 * @summary Stops all current animations
 * @private
 */
PhotoSphereViewer.prototype._stopAll = function() {
  this.stopAutorotate();
  this.stopAnimation();
  this.stopGyroscopeControl();
  this.stopStereoView();
};


/**
 * @summary Number of pixels bellow which a mouse move will be considered as a click
 * @type {int}
 * @readonly
 * @private
 */
PhotoSphereViewer.MOVE_THRESHOLD = 4;

/**
 * @summary Angle in radians bellow which two angles are considered identical
 * @type {float}
 * @readonly
 * @private
 */
PhotoSphereViewer.ANGLE_THRESHOLD = 0.003;

/**
 * @summary Delay in milliseconds between two clicks to consider a double click
 * @type {int}
 * @readonly
 * @private
 */
PhotoSphereViewer.DBLCLICK_DELAY = 300;

/**
 * @summary Time size of the mouse position history used to compute inertia
 * @type {int}
 * @readonly
 * @private
 */
PhotoSphereViewer.INERTIA_WINDOW = 300;

/**
 * @summary Radius of the THREE.SphereGeometry
 * Half-length of the THREE.BoxGeometry
 * @type {int}
 * @readonly
 * @private
 */
PhotoSphereViewer.SPHERE_RADIUS = 100;

/**
 * @summary Number of vertice of the THREE.SphereGeometry
 * @type {int}
 * @readonly
 * @private
 */
PhotoSphereViewer.SPHERE_VERTICES = 64;

/**
 * @summary Number of vertices of each side of the THREE.BoxGeometry
 * @type {int}
 * @readonly
 * @private
 */
PhotoSphereViewer.CUBE_VERTICES = 8;

/**
 * @summary Order of cube textures for arrays
 * @type {int[]}
 * @readonly
 * @private
 */
PhotoSphereViewer.CUBE_MAP = [0, 2, 4, 5, 3, 1];

/**
 * @summary Order of cube textures for maps
 * @type {string[]}
 * @readonly
 * @private
 */
PhotoSphereViewer.CUBE_HASHMAP = ['left', 'right', 'top', 'bottom', 'back', 'front'];

/**
 * @summary Map between keyboard events `keyCode|which` and `key`
 * @type {Object.<int, string>}
 * @readonly
 * @private
 */
PhotoSphereViewer.KEYMAP = {
  33: 'PageUp',
  34: 'PageDown',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  107: '+',
  109: '-'
};

/**
 * @summary System properties
 * @type {Object}
 * @readonly
 * @private
 */
PhotoSphereViewer.SYSTEM = {
  loaded: false,
  pixelRatio: 1,
  isWebGLSupported: false,
  isCanvasSupported: false,
  deviceOrientationSupported: null,
  maxTextureWidth: 0,
  mouseWheelEvent: null,
  fullscreenEvent: null
};

/**
 * @summary SVG icons sources
 * @type {Object.<string, string>}
 * @readonly
 */
PhotoSphereViewer.ICONS = {};

/**
 * @summary Default options, see {@link http://photo-sphere-viewer.js.org/#options}
 * @type {Object}
 * @readonly
 */
PhotoSphereViewer.DEFAULTS = {
  panorama: null,
  container: null,
  caption: null,
  usexmpdata: true,
  pano_data: null,
  webgl: true,
  min_fov: 30,
  max_fov: 90,
  default_fov: null,
  default_long: 0,
  default_lat: 0,
  sphere_correction: {
    pan: 0,
    tilt: 0,
    roll: 0
  },
  longitude_range: null,
  latitude_range: null,
  move_speed: 1,
  zoom_speed: 2,
  time_anim: 2000,
  anim_speed: '2rpm',
  anim_lat: null,
  fisheye: false,
  navbar: [
    'autorotate',
    'zoom',
    'download',
    'markers',
    'caption',
    'gyroscope',
    'stereo',
    'fullscreen'
  ],
  tooltip: {
    offset: 5,
    arrow_size: 7,
    delay: 100
  },
  lang: {
    autorotate: 'Automatic rotation',
    zoom: 'Zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    download: 'Download',
    fullscreen: 'Fullscreen',
    markers: 'Markers',
    gyroscope: 'Gyroscope',
    stereo: 'Stereo view',
    stereo_notification: 'Click anywhere to exit stereo view.',
    please_rotate: ['Please rotate your device', '(or tap to continue)']
  },
  mousewheel: true,
  mousewheel_factor: 1,
  mousemove: true,
  mousemove_hover: false,
  keyboard: true,
  move_inertia: true,
  click_event_on_marker: false,
  transition: {
    duration: 1500,
    loader: true
  },
  loading_img: null,
  loading_txt: 'Loading...',
  size: null,
  cache_texture: 0,
  templates: {},
  markers: [],
  with_credentials: false
};

/**
 * @summary doT.js templates
 * @type {Object.<string, string>}
 * @readonly
 */
PhotoSphereViewer.TEMPLATES = {
  markersList: '\
<div class="psv-markers-list-container"> \
  <h1 class="psv-markers-list-title">{{= it.config.lang.markers }}</h1> \
  <ul class="psv-markers-list"> \
  {{~ it.markers: marker }} \
    <li data-psv-marker="{{= marker.id }}" class="psv-markers-list-item {{? marker.className }}{{= marker.className }}{{?}}"> \
      {{? marker.image }}<img class="psv-markers-list-image" src="{{= marker.image }}"/>{{?}} \
      <p class="psv-markers-list-name">{{? marker.tooltip }}{{= marker.tooltip.content }}{{?? marker.html }}{{= marker.html }}{{??}}{{= marker.id }}{{?}}</p> \
    </li> \
  {{~}} \
  </ul> \
</div>'
};


/**
 * @summary Adds all needed event listeners
 * @private
 */
PhotoSphereViewer.prototype._bindEvents = function() {
  window.addEventListener('resize', this);

  // all interation events are binded to the HUD only
  if (this.config.mousemove) {
    this.hud.container.style.cursor = 'move';

    if (this.config.mousemove_hover) {
      this.hud.container.addEventListener('mouseenter', this);
      this.hud.container.addEventListener('mouseleave', this);
    }
    else {
      this.hud.container.addEventListener('mousedown', this);
      window.addEventListener('mouseup', this);
    }

    this.hud.container.addEventListener('touchstart', this);
    window.addEventListener('touchend', this);

    this.hud.container.addEventListener('mousemove', this);
    this.hud.container.addEventListener('touchmove', this);
  }

  if (PhotoSphereViewer.SYSTEM.fullscreenEvent) {
    document.addEventListener(PhotoSphereViewer.SYSTEM.fullscreenEvent, this);
  }

  if (this.config.mousewheel) {
    this.hud.container.addEventListener(PhotoSphereViewer.SYSTEM.mouseWheelEvent, this);
  }

  this.on('_side-reached', function(side) {
    if (this.isAutorotateEnabled()) {
      if (side === 'left' || side === 'right') {
        this._reverseAutorotate();
      }
    }
  });
};

/**
 * @summary Removes all event listeners
 * @private
 */
PhotoSphereViewer.prototype._unbindEvents = function() {
  window.removeEventListener('resize', this);

  if (this.config.mousemove) {
    this.hud.container.removeEventListener('mousedown', this);
    this.hud.container.removeEventListener('mouseenter', this);
    this.hud.container.removeEventListener('touchstart', this);
    window.removeEventListener('mouseup', this);
    window.removeEventListener('touchend', this);
    this.hud.container.removeEventListener('mouseleave', this);
    this.hud.container.removeEventListener('mousemove', this);
    this.hud.container.removeEventListener('touchmove', this);
  }

  if (PhotoSphereViewer.SYSTEM.fullscreenEvent) {
    document.removeEventListener(PhotoSphereViewer.SYSTEM.fullscreenEvent, this);
  }

  if (this.config.mousewheel) {
    this.hud.container.removeEventListener(PhotoSphereViewer.SYSTEM.mouseWheelEvent, this);
  }

  this.off('_side-reached');
};

/**
 * @summary Handles events
 * @param {Event} evt
 * @private
 */
PhotoSphereViewer.prototype.handleEvent = function(evt) {
  switch (evt.type) {
    // @formatter:off
    case 'resize': PSVUtils.throttle(this._onResize(), 50); break;
    case 'keydown':     this._onKeyDown(evt);     break;
    case 'mousedown':   this._onMouseDown(evt);   break;
    case 'mouseenter':  this._onMouseDown(evt);   break;
    case 'touchstart':  this._onTouchStart(evt);  break;
    case 'mouseup':     this._onMouseUp(evt);     break;
    case 'mouseleave':  this._onMouseUp(evt);     break;
    case 'touchend':    this._onTouchEnd(evt);    break;
    case 'mousemove':   this._onMouseMove(evt);   break;
    case 'touchmove':   this._onTouchMove(evt);   break;
    case PhotoSphereViewer.SYSTEM.fullscreenEvent:  this._fullscreenToggled();  break;
    case PhotoSphereViewer.SYSTEM.mouseWheelEvent:  this._onMouseWheel(evt);    break;
    // @formatter:on
  }
};

/**
 * @summary Resizes the canvas when the window is resized
 * @fires PhotoSphereViewer.size-updated
 * @private
 */
PhotoSphereViewer.prototype._onResize = function() {
  if (this.container.clientWidth !== this.prop.size.width || this.container.clientHeight !== this.prop.size.height) {
    this.prop.size.width = parseInt(this.container.clientWidth);
    this.prop.size.height = parseInt(this.container.clientHeight);
    this.prop.aspect = this.prop.size.width / this.prop.size.height;
    this.needsUpdate();

    if (this.renderer) {
      (this.stereoEffect || this.renderer).setSize(this.prop.size.width, this.prop.size.height);
    }

    /**
     * @event size-updated
     * @memberof PhotoSphereViewer
     * @summary Triggered when the viewer size changes
     * @param {PhotoSphereViewer.Size} size
     */
    this.trigger('size-updated', this.getSize());
  }
};

/**
 * @summary Handles keyboard events
 * @param {KeyboardEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onKeyDown = function(evt) {
  var dLong = 0;
  var dLat = 0;
  var dZoom = 0;

  var key = evt.key || PhotoSphereViewer.KEYMAP[evt.keyCode || evt.which];

  switch (key) {
    // @formatter:off
    case 'ArrowUp': dLat = 0.01; break;
    case 'ArrowDown': dLat = -0.01; break;
    case 'ArrowRight': dLong = 0.01; break;
    case 'ArrowLeft': dLong = -0.01; break;
    case 'PageUp':case '+': dZoom = 1; break;
    case 'PageDown':case '-': dZoom = -1; break;
    // @formatter:on
  }

  if (dZoom !== 0) {
    this.zoom(this.prop.zoom_lvl + dZoom * this.config.zoom_speed);
  }
  else if (dLat !== 0 || dLong !== 0) {
    this.rotate({
      longitude: this.prop.position.longitude + dLong * this.prop.move_speed * this.prop.hFov,
      latitude: this.prop.position.latitude + dLat * this.prop.move_speed * this.prop.vFov
    });
  }
};

/**
 * @summary Handles mouse button events
 * @param {MouseEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onMouseDown = function(evt) {
  this._startMove(evt);
};

/**
 * @summary Handles mouse buttons events
 * @param {MouseEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onMouseUp = function(evt) {
  this._stopMove(evt);

  if (this.isStereoEnabled()) {
    this.stopStereoView();
  }
};

/**
 * @summary Handles mouse move events
 * @param {MouseEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onMouseMove = function(evt) {
  if (evt.buttons !== 0) {
    evt.preventDefault();
    this._move(evt);
  }
  else if (this.config.mousemove_hover) {
    this._moveAbsolute(evt);
  }
};

/**
 * @summary Handles touch events
 * @param {TouchEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onTouchStart = function(evt) {
  if (evt.touches.length === 1) {
    this._startMove(evt.touches[0]);
  }
  else if (evt.touches.length === 2) {
    this._startZoom(evt);
  }
};

/**
 * @summary Handles touch events
 * @param {TouchEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onTouchEnd = function(evt) {
  this._stopMove(evt.changedTouches[0]);
};

/**
 * @summary Handles touch move events
 * @param {TouchEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onTouchMove = function(evt) {
  if (evt.touches.length === 1) {
    evt.preventDefault();
    this._move(evt.touches[0]);
  }
  else if (evt.touches.length === 2) {
    evt.preventDefault();
    this._zoom(evt);
  }
};

/**
 * @summary Initializes the movement
 * @param {MouseEvent|Touch} evt
 * @private
 */
PhotoSphereViewer.prototype._startMove = function(evt) {
  this.stopAutorotate();
  this.stopAnimation();

  this.prop.mouse_x = this.prop.start_mouse_x = parseInt(evt.clientX);
  this.prop.mouse_y = this.prop.start_mouse_y = parseInt(evt.clientY);
  this.prop.moving = true;
  this.prop.zooming = false;

  this.prop.mouse_history.length = 0;
  this._logMouseMove(evt);
};

/**
 * @summary Initializes the zoom
 * @param {TouchEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._startZoom = function(evt) {
  var t = [
    { x: parseInt(evt.touches[0].clientX), y: parseInt(evt.touches[0].clientY) },
    { x: parseInt(evt.touches[1].clientX), y: parseInt(evt.touches[1].clientY) }
  ];

  this.prop.pinch_dist = Math.sqrt(Math.pow(t[0].x - t[1].x, 2) + Math.pow(t[0].y - t[1].y, 2));
  this.prop.moving = false;
  this.prop.zooming = true;
};

/**
 * @summary Stops the movement
 * @description If the move threshold was not reached a click event is triggered, otherwise an animation is launched to simulate inertia
 * @param {MouseEvent|Touch} evt
 * @private
 */
PhotoSphereViewer.prototype._stopMove = function(evt) {
  if (!PSVUtils.getClosest(evt.target, '.psv-hud')) {
    return;
  }

  if (this.prop.moving) {
    // move threshold to trigger a click
    if (Math.abs(evt.clientX - this.prop.start_mouse_x) < PhotoSphereViewer.MOVE_THRESHOLD && Math.abs(evt.clientY - this.prop.start_mouse_y) < PhotoSphereViewer.MOVE_THRESHOLD) {
      this._click(evt);
      this.prop.moving = false;
    }
    // inertia animation
    else if (this.config.move_inertia && !this.isGyroscopeEnabled()) {
      this._logMouseMove(evt);
      this._stopMoveInertia(evt);
    }
    else {
      this.prop.moving = false;
    }

    this.prop.mouse_history.length = 0;
  }

  this.prop.zooming = false;
};

/**
 * @summary Performs an animation to simulate inertia when the movement stops
 * @param {MouseEvent|Touch} evt
 * @private
 */
PhotoSphereViewer.prototype._stopMoveInertia = function(evt) {
  var direction = {
    x: evt.clientX - this.prop.mouse_history[0][1],
    y: evt.clientY - this.prop.mouse_history[0][2]
  };

  var norm = Math.sqrt(direction.x * direction.x + direction.y * direction.y);

  this.prop.animation_promise = PSVUtils.animation({
    properties: {
      clientX: { start: evt.clientX, end: evt.clientX + direction.x },
      clientY: { start: evt.clientY, end: evt.clientY + direction.y }
    },
    duration: norm * PhotoSphereViewer.INERTIA_WINDOW / 100,
    easing: 'outCirc',
    onTick: function(properties) {
      this._move(properties, false);
    }.bind(this)
  })
    .ensure(function() {
      this.prop.moving = false;
    }.bind(this));
};

/**
 * @summary Triggers an event with all coordinates when a simple click is performed
 * @param {MouseEvent|Touch} evt
 * @fires PhotoSphereViewer.click
 * @fires PhotoSphereViewer.dblclick
 * @private
 */
PhotoSphereViewer.prototype._click = function(evt) {
  var boundingRect = this.container.getBoundingClientRect();

  var data = {
    target: evt.target,
    client_x: evt.clientX,
    client_y: evt.clientY,
    viewer_x: parseInt(evt.clientX - boundingRect.left),
    viewer_y: parseInt(evt.clientY - boundingRect.top)
  };

  var intersect = this.viewerCoordsToVector3({ x: data.viewer_x, y: data.viewer_y });

  if (intersect) {
    var sphericalCoords = this.vector3ToSphericalCoords(intersect);
    data.longitude = sphericalCoords.longitude;
    data.latitude = sphericalCoords.latitude;

    // TODO: for cubemap, computes texture's index and coordinates
    if (!this.prop.isCubemap) {
      var textureCoords = this.sphericalCoordsToTextureCoords({ longitude: data.longitude, latitude: data.latitude });
      data.texture_x = textureCoords.x;
      data.texture_y = textureCoords.y;
    }

    if (!this.prop.dblclick_timeout) {
      /**
       * @event click
       * @memberof PhotoSphereViewer
       * @summary Triggered when the user clicks on the viewer (everywhere excluding the navbar and the side panel)
       * @param {PhotoSphereViewer.ClickData} data
       */
      this.trigger('click', data);

      this.prop.dblclick_data = PSVUtils.clone(data);
      this.prop.dblclick_timeout = setTimeout(function() {
        this.prop.dblclick_timeout = null;
        this.prop.dblclick_data = null;
      }.bind(this), PhotoSphereViewer.DBLCLICK_DELAY);
    }
    else {
      if (Math.abs(this.prop.dblclick_data.client_x - data.client_x) < PhotoSphereViewer.MOVE_THRESHOLD &&
        Math.abs(this.prop.dblclick_data.client_y - data.client_y) < PhotoSphereViewer.MOVE_THRESHOLD) {
        /**
         * @event dblclick
         * @memberof PhotoSphereViewer
         * @summary Triggered when the user double clicks on the viewer. The simple `click` event is always fired before `dblclick`
         * @param {PhotoSphereViewer.ClickData} data
         */
        this.trigger('dblclick', this.prop.dblclick_data);
      }

      clearTimeout(this.prop.dblclick_timeout);
      this.prop.dblclick_timeout = null;
      this.prop.dblclick_data = null;
    }
  }
};

/**
 * @summary Performs movement
 * @param {MouseEvent|Touch} evt
 * @param {boolean} [log=true]
 * @private
 */
PhotoSphereViewer.prototype._move = function(evt, log) {
  if (this.prop.moving) {
    var x = parseInt(evt.clientX);
    var y = parseInt(evt.clientY);

    var rotation = {
      longitude: (x - this.prop.mouse_x) / this.prop.size.width * this.prop.move_speed * this.prop.hFov * PhotoSphereViewer.SYSTEM.pixelRatio,
      latitude: (y - this.prop.mouse_y) / this.prop.size.height * this.prop.move_speed * this.prop.vFov * PhotoSphereViewer.SYSTEM.pixelRatio
    };

    if (this.isGyroscopeEnabled()) {
      this.prop.gyro_alpha_offset += rotation.longitude;
    }
    else {
      this.rotate({
        longitude: this.prop.position.longitude - rotation.longitude,
        latitude: this.prop.position.latitude + rotation.latitude
      });
    }

    this.prop.mouse_x = x;
    this.prop.mouse_y = y;

    if (log !== false) {
      this._logMouseMove(evt);
    }
  }
};

/**
 * @summary Performs movement absolute to cursor position in viewer
 * @param {MouseEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._moveAbsolute = function(evt) {
  if (this.prop.moving) {
    this.rotate({
      longitude: ((evt.clientX - this.container.offsetLeft) / this.container.offsetWidth - 0.5) * PSVUtils.TwoPI,
      latitude: -((evt.clientY - this.container.offsetTop) / this.container.offsetHeight - 0.5) * Math.PI
    });
  }
};

/**
 * @summary Perfoms zoom
 * @param {TouchEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._zoom = function(evt) {
  if (this.prop.zooming) {
    var t = [
      { x: parseInt(evt.touches[0].clientX), y: parseInt(evt.touches[0].clientY) },
      { x: parseInt(evt.touches[1].clientX), y: parseInt(evt.touches[1].clientY) }
    ];

    var p = Math.sqrt(Math.pow(t[0].x - t[1].x, 2) + Math.pow(t[0].y - t[1].y, 2));
    var delta = 80 * (p - this.prop.pinch_dist) / this.prop.size.width;

    this.zoom(this.prop.zoom_lvl + delta);

    this.prop.pinch_dist = p;
  }
};

/**
 * @summary Handles mouse wheel events
 * @param {MouseWheelEvent} evt
 * @private
 */
PhotoSphereViewer.prototype._onMouseWheel = function(evt) {
  evt.preventDefault();
  evt.stopPropagation();

  var delta = PSVUtils.normalizeWheel(evt).spinY * 5;

  if (delta !== 0) {
    this.zoom(this.prop.zoom_lvl - delta * this.config.mousewheel_factor);
  }
};

/**
 * @summary Handles fullscreen events
 * @fires PhotoSphereViewer.fullscreen-updated
 * @private
 */
PhotoSphereViewer.prototype._fullscreenToggled = function() {
  var enabled = this.isFullscreenEnabled();

  if (this.config.keyboard) {
    if (enabled) {
      this.startKeyboardControl();
    }
    else {
      this.stopKeyboardControl();
    }
  }

  /**
   * @event fullscreen-updated
   * @memberof PhotoSphereViewer
   * @summary Triggered when the fullscreen mode is enabled/disabled
   * @param {boolean} enabled
   */
  this.trigger('fullscreen-updated', enabled);
};

/**
 * @summary Stores each mouse position during a mouse move
 * @description Positions older than "INERTIA_WINDOW" are removed<br>
 *     Positions before a pause of "INERTIA_WINDOW" / 10 are removed
 * @param {MouseEvent|Touch} evt
 * @private
 */
PhotoSphereViewer.prototype._logMouseMove = function(evt) {
  var now = Date.now();
  this.prop.mouse_history.push([now, evt.clientX, evt.clientY]);

  var previous = null;

  for (var i = 0; i < this.prop.mouse_history.length;) {
    if (this.prop.mouse_history[0][i] < now - PhotoSphereViewer.INERTIA_WINDOW) {
      this.prop.mouse_history.splice(i, 1);
    }
    else if (previous && this.prop.mouse_history[0][i] - previous > PhotoSphereViewer.INERTIA_WINDOW / 10) {
      this.prop.mouse_history.splice(0, i);
      i = 0;
      previous = this.prop.mouse_history[0][i];
    }
    else {
      i++;
      previous = this.prop.mouse_history[0][i];
    }
  }
};


/**
 * @summary Starts to load the panorama
 * @returns {Promise}
 * @throws {PSVError} when the panorama is not configured
 * @deprecated Use {@link PhotoSphereViewer#setPanorama} instead
 */
PhotoSphereViewer.prototype.load = function() {
  if (!this.config.panorama) {
    throw new PSVError('No value given for panorama.');
  }

  return this.setPanorama(this.config.panorama, false);
};

/**
 * @summary Returns the current position of the camera
 * @returns {PhotoSphereViewer.Position}
 */
PhotoSphereViewer.prototype.getPosition = function() {
  return {
    longitude: this.prop.position.longitude,
    latitude: this.prop.position.latitude
  };
};

/**
 * @summary Returns the current zoom level
 * @returns {int}
 */
PhotoSphereViewer.prototype.getZoomLevel = function() {
  return this.prop.zoom_lvl;
};

/**
 * @summary Returns the current viewer size
 * @returns {PhotoSphereViewer.Size}
 */
PhotoSphereViewer.prototype.getSize = function() {
  return {
    width: this.prop.size.width,
    height: this.prop.size.height
  };
};

/**
 * @summary Checks if the automatic rotation is enabled
 * @returns {boolean}
 */
PhotoSphereViewer.prototype.isAutorotateEnabled = function() {
  return !!this.prop.autorotate_cb;
};

/**
 * @summary Checks if the gyroscope is enabled
 * @returns {boolean}
 */
PhotoSphereViewer.prototype.isGyroscopeEnabled = function() {
  return !!this.prop.orientation_cb;
};

/**
 * @summary Checks if the stereo viewx is enabled
 * @returns {boolean}
 */
PhotoSphereViewer.prototype.isStereoEnabled = function() {
  return !!this.stereoEffect;
};

/**
 * @summary Checks if the viewer is in fullscreen
 * @returns {boolean}
 */
PhotoSphereViewer.prototype.isFullscreenEnabled = function() {
  return PSVUtils.isFullscreenEnabled(this.container);
};

/**
 * @summary Flags the view has changed for the next render
 */
PhotoSphereViewer.prototype.needsUpdate = function() {
  this.prop.needsUpdate = true;
};

/**
 * @summary Performs a render
 * @deprecated Use {@link PhotoSphereViewer.event:before-render} instead
 */
PhotoSphereViewer.prototype.render = function() {
  this._render();
};

/**
 * @summary Destroys the viewer
 * @description The memory used by the ThreeJS context is not totally cleared. This will be fixed as soon as possible.
 */
PhotoSphereViewer.prototype.destroy = function() {
  window.cancelAnimationFrame(this.prop.main_reqid);

  this._stopAll();
  this.stopKeyboardControl();
  this.stopNoSleep();
  this.exitFullscreen();
  this.unlockOrientation();

  // remove listeners
  this._unbindEvents();

  // destroy components
  if (this.tooltip) {
    this.tooltip.destroy();
  }
  if (this.notification) {
    this.notification.destroy();
  }
  if (this.hud) {
    this.hud.destroy();
  }
  if (this.loader) {
    this.loader.destroy();
  }
  if (this.navbar) {
    this.navbar.destroy();
  }
  if (this.panel) {
    this.panel.destroy();
  }
  if (this.pleaseRotate) {
    this.pleaseRotate.destroy();
  }

  // destroy ThreeJS view
  if (this.scene) {
    PSVUtils.cleanTHREEScene(this.scene);
  }

  // remove container
  if (this.canvas_container) {
    this.container.removeChild(this.canvas_container);
  }
  this.parent.removeChild(this.container);

  delete this.parent.photoSphereViewer;

  // clean references
  delete this.parent;
  delete this.container;
  delete this.loader;
  delete this.navbar;
  delete this.hud;
  delete this.panel;
  delete this.tooltip;
  delete this.notification;
  delete this.pleaseRotate;
  delete this.canvas_container;
  delete this.renderer;
  delete this.noSleep;
  delete this.scene;
  delete this.camera;
  delete this.mesh;
  delete this.raycaster;
  delete this.passes;
  delete this.config;
  this.prop.cache.length = 0;
};

/**
 * @summary Loads a new panorama file
 * @description Loads a new panorama file, optionally changing the camera position and activating the transition animation.<br>
 * If the "position" is not defined, the camera will not move and the ongoing animation will continue<br>
 * "config.transition" must be configured for "transition" to be taken in account
 * @param {string|string[]} path - URL of the new panorama file
 * @param {PhotoSphereViewer.ExtendedPosition} [position]
 * @param {boolean} [transition=false]
 * @returns {Promise}
 * @throws {PSVError} when another panorama is already loading
 */
PhotoSphereViewer.prototype.setPanorama = function(path, position, transition) {
  if (this.prop.loading_promise !== null) {
    throw new PSVError('Loading already in progress');
  }

  if (typeof position === 'boolean') {
    transition = position;
    position = undefined;
  }

  if (position) {
    this.cleanPosition(position);

    this._stopAll();
  }

  this.config.panorama = path;

  if (!transition || !this.config.transition || !this.scene) {
    this.loader.show();
    if (this.canvas_container) {
      this.canvas_container.style.opacity = 0;
    }

    this.prop.loading_promise = this._loadTexture(this.config.panorama)
      .then(function(texture) {
        this._setTexture(texture);

        if (position) {
          this.rotate(position);
        }
      }.bind(this))
      .ensure(function() {
        this.loader.hide();
        this.canvas_container.style.opacity = 1;

        this.prop.loading_promise = null;
      }.bind(this))
      .rethrow();
  }
  else {
    if (this.config.transition.loader) {
      this.loader.show();
    }

    this.prop.loading_promise = this._loadTexture(this.config.panorama)
      .then(function(texture) {
        this.loader.hide();

        return this._transition(texture, position);
      }.bind(this))
      .ensure(function() {
        this.loader.hide();

        this.prop.loading_promise = null;
      }.bind(this))
      .rethrow();
  }

  return this.prop.loading_promise;
};

/**
 * @summary Starts the automatic rotation
 * @fires PhotoSphereViewer.autorotate
 */
PhotoSphereViewer.prototype.startAutorotate = function() {
  this._stopAll();

  this.prop.autorotate_cb = this._getAutorotateUpdate();
  this.on('before-render', this.prop.autorotate_cb);

  /**
   * @event autorotate
   * @memberof PhotoSphereViewer
   * @summary Triggered when the automatic rotation is enabled/disabled
   * @param {boolean} enabled
   */
  this.trigger('autorotate', true);
};

/**
 * @summary Create an animation callback for the automatic rotation
 * @returns {function}
 * @private
 */
PhotoSphereViewer.prototype._getAutorotateUpdate = function() {
  var last;
  var elapsed;

  return function(timestamp) {
    elapsed = last === undefined ? 0 : timestamp - last;
    last = timestamp;

    this.rotate({
      longitude: this.prop.position.longitude + this.config.anim_speed * elapsed / 1000,
      latitude: this.prop.position.latitude - (this.prop.position.latitude - this.config.anim_lat) / 200
    });
  };
};

/**
 * @summary Stops the automatic rotation
 * @fires PhotoSphereViewer.autorotate
 */
PhotoSphereViewer.prototype.stopAutorotate = function() {
  if (this.prop.start_timeout) {
    window.clearTimeout(this.prop.start_timeout);
    this.prop.start_timeout = null;
  }

  if (this.isAutorotateEnabled()) {
    this.off('before-render', this.prop.autorotate_cb);
    this.prop.autorotate_cb = null;

    this.trigger('autorotate', false);
  }
};

/**
 * @summary Starts or stops the automatic rotation
 */
PhotoSphereViewer.prototype.toggleAutorotate = function() {
  if (this.isAutorotateEnabled()) {
    this.stopAutorotate();
  }
  else {
    this.startAutorotate();
  }
};

/**
 * @summary Enables the gyroscope navigation if available
 * @fires PhotoSphereViewer.gyroscope-updated
 * @throws {PSVError} if DeviceOrientationControls.js is missing
 */
PhotoSphereViewer.prototype.startGyroscopeControl = function() {
  if (PSVUtils.checkTHREE('DeviceOrientationControls')) {
    return PhotoSphereViewer.SYSTEM.deviceOrientationSupported.then(
      function() {
        this._stopAll();

        this.doControls = new THREE.DeviceOrientationControls(this.camera);

        // compute the alpha offset to keep the current orientation
        this.doControls.alphaOffset = this.prop.position.longitude;
        this.doControls.update();

        var direction = this.camera.getWorldDirection(new THREE.Vector3());
        var sphericalCoords = this.vector3ToSphericalCoords(direction);

        this.prop.gyro_alpha_offset = sphericalCoords.longitude;

        this.prop.orientation_cb = this._getOrientationUpdate();
        this.on('before-render', this.prop.orientation_cb);

        /**
         * @event gyroscope-updated
         * @memberof PhotoSphereViewer
         * @summary Triggered when the gyroscope mode is enabled/disabled
         * @param {boolean} enabled
         */
        this.trigger('gyroscope-updated', true);
      }.bind(this),
      function() {
        console.warn('PhotoSphereViewer: gyroscope not available');
        return D.rejected();
      }
    );
  }
  else {
    throw new PSVError('Missing Three.js components: DeviceOrientationControls. Get them from three.js-examples package.');
  }
};

/**
 * @summary Create an animation callback for the orientation controls
 * @returns {function}
 * @private
 */
PhotoSphereViewer.prototype._getOrientationUpdate = function() {
  return function() {
    this.doControls.alphaOffset = this.prop.gyro_alpha_offset;
    this.doControls.update();

    this.camera.getWorldDirection(this.prop.direction);
    this.prop.direction.multiplyScalar(PhotoSphereViewer.SPHERE_RADIUS);

    var sphericalCoords = this.vector3ToSphericalCoords(this.prop.direction);
    this.prop.position.longitude = sphericalCoords.longitude;
    this.prop.position.latitude = sphericalCoords.latitude;
    this.needsUpdate();
  };
};

/**
 * @summary Disables the gyroscope navigation
 * @fires PhotoSphereViewer.gyroscope-updated
 */
PhotoSphereViewer.prototype.stopGyroscopeControl = function() {
  if (this.isGyroscopeEnabled()) {
    this.off('before-render', this.prop.orientation_cb);
    this.prop.orientation_cb = null;

    this.doControls.disconnect();
    this.doControls = null;

    this.trigger('gyroscope-updated', false);
  }
};

/**
 * @summary Enables or disables the gyroscope navigation
 */
PhotoSphereViewer.prototype.toggleGyroscopeControl = function() {
  if (this.isGyroscopeEnabled()) {
    this.stopGyroscopeControl();
  }
  else {
    this.startGyroscopeControl();
  }
};

/**
 * @summary Enables NoSleep.js
 */
PhotoSphereViewer.prototype.startNoSleep = function() {
  if (!('NoSleep' in window)) {
    console.warn('PhotoSphereViewer: NoSleep is not available');
    return;
  }

  if (!this.noSleep) {
    this.noSleep = new NoSleep();
  }

  this.noSleep.enable();
};

/**
 * @summary Disables NoSleep.js
 */
PhotoSphereViewer.prototype.stopNoSleep = function() {
  if (this.noSleep) {
    this.noSleep.disable();
  }
};

/**
 * @summary Enables the stereo view
 * @description
 *  - enables NoSleep.js
 *  - enables full screen
 *  - starts gyroscope controle
 *  - hides hud, navbar and panel
 *  - instanciate StereoEffect
 * @throws {PSVError} if StereoEffect.js is not available
 */
PhotoSphereViewer.prototype.startStereoView = function() {
  if (PSVUtils.checkTHREE('DeviceOrientationControls', 'StereoEffect')) {
    // Need to be in the main event queue
    this.startNoSleep();
    this.enterFullscreen();
    this.lockOrientation();

    this.startGyroscopeControl().then(
      function() {
        this.stereoEffect = new THREE.StereoEffect(this.renderer);
        this.needsUpdate();

        this.hud.hide();
        this.navbar.hide();
        this.panel.hidePanel();

        /**
         * @event stereo-updated
         * @memberof PhotoSphereViewer
         * @summary Triggered when the stereo view is enabled/disabled
         * @param {boolean} enabled
         */
        this.trigger('stereo-updated', true);

        this.notification.showNotification({
          content: this.config.lang.stereo_notification,
          timeout: 3000
        });
      }.bind(this),
      function() {
        this.unlockOrientation();
        this.exitFullscreen();
        this.stopNoSleep();
      }.bind(this)
    );
  }
  else {
    throw new PSVError('Missing Three.js components: StereoEffect, DeviceOrientationControls. Get them from three.js-examples package.');
  }
};

/**
 * @summary Disables the stereo view
 */
PhotoSphereViewer.prototype.stopStereoView = function() {
  if (this.isStereoEnabled()) {
    this.stereoEffect = null;
    this.needsUpdate();

    this.hud.show();
    this.navbar.show();

    this.unlockOrientation();
    this.exitFullscreen();
    this.stopNoSleep();
    this.stopGyroscopeControl();

    this.trigger('stereo-updated', false);
  }
};

/**
 * @summary Tries to lock the device in landscape or display a message
 */
PhotoSphereViewer.prototype.lockOrientation = function() {
  var displayRotateMessage = function() {
    if (window.innerHeight > window.innerWidth) {
      if (!this.pleaseRotate) {
        this.pleaseRotate = new PSVPleaseRotate(this);
      }
      this.pleaseRotate.show();
    }
  };

  if (window.screen && window.screen.orientation) {
    window.screen.orientation.lock('landscape').then(null, displayRotateMessage.bind(this));
  }
  else {
    displayRotateMessage.apply(this);
  }
};

/**
 * @summary Unlock the device orientation
 */
PhotoSphereViewer.prototype.unlockOrientation = function() {
  if (window.screen && window.screen.orientation) {
    window.screen.orientation.unlock();
  }
  else {
    if (this.pleaseRotate) {
      this.pleaseRotate.hide();
    }
  }
};

/**
 * @summary Enables or disables the stereo view
 */
PhotoSphereViewer.prototype.toggleStereoView = function() {
  if (this.isStereoEnabled()) {
    this.stopStereoView();
  }
  else {
    this.startStereoView();
  }
};

/**
 * @summary Rotates the view to specific longitude and latitude
 * @param {PhotoSphereViewer.ExtendedPosition} position
 * @fires PhotoSphereViewer._side-reached
 * @fires PhotoSphereViewer.position-updated
 */
PhotoSphereViewer.prototype.rotate = function(position) {
  this.cleanPosition(position);

  /**
   * @event _side-reached
   * @memberof PhotoSphereViewer
   * @param {string} side
   * @private
   */
  this.applyRanges(position).forEach(
    this.trigger.bind(this, '_side-reached')
  );

  this.prop.position.longitude = position.longitude;
  this.prop.position.latitude = position.latitude;
  this.needsUpdate();

  /**
   * @event position-updated
   * @memberof PhotoSphereViewer
   * @summary Triggered when the view longitude and/or latitude changes
   * @param {PhotoSphereViewer.Position} position
   */
  this.trigger('position-updated', this.getPosition());
};

/**
 * @summary Rotates the view to specific longitude and latitude with a smooth animation
 * @param {PhotoSphereViewer.ExtendedPosition} position
 * @param {string|int} duration - animation speed or duration (in milliseconds)
 * @returns {Promise}
 */
PhotoSphereViewer.prototype.animate = function(position, duration) {
  this._stopAll();

  this.cleanPosition(position);

  if (!duration || Math.abs(position.longitude - this.prop.position.longitude) < PhotoSphereViewer.ANGLE_THRESHOLD && Math.abs(position.latitude - this.prop.position.latitude) < PhotoSphereViewer.ANGLE_THRESHOLD) {
    this.rotate(position);

    return D.resolved();
  }

  this.applyRanges(position).forEach(
    this.trigger.bind(this, '_side-reached')
  );

  if (!duration && typeof duration !== 'number') {
    // desired radial speed
    duration = duration ? PSVUtils.parseSpeed(duration) : this.config.anim_speed;
    // get the angle between current position and target
    var angle = Math.acos(
      Math.cos(this.prop.position.latitude) * Math.cos(position.latitude) * Math.cos(this.prop.position.longitude - position.longitude) +
      Math.sin(this.prop.position.latitude) * Math.sin(position.latitude)
    );
    // compute duration
    duration = angle / duration * 1000;
  }

  // longitude offset for shortest arc
  var tOffset = PSVUtils.getShortestArc(this.prop.position.longitude, position.longitude);

  this.prop.animation_promise = PSVUtils.animation({
    properties: {
      longitude: { start: this.prop.position.longitude, end: this.prop.position.longitude + tOffset },
      latitude: { start: this.prop.position.latitude, end: position.latitude }
    },
    duration: duration,
    easing: 'inOutSine',
    onTick: this.rotate.bind(this)
  });

  return this.prop.animation_promise;
};

/**
 * @summary Stops the ongoing animation
 */
PhotoSphereViewer.prototype.stopAnimation = function() {
  if (this.prop.animation_promise) {
    this.prop.animation_promise.cancel();
    this.prop.animation_promise = null;
  }
};

/**
 * @summary Zooms to a specific level between `max_fov` and `min_fov`
 * @param {int} level - new zoom level from 0 to 100
 * @fires PhotoSphereViewer.zoom-updated
 */
PhotoSphereViewer.prototype.zoom = function(level) {
  this.prop.zoom_lvl = PSVUtils.bound(Math.round(level), 0, 100);
  this.prop.vFov = this.config.max_fov + (this.prop.zoom_lvl / 100) * (this.config.min_fov - this.config.max_fov);
  this.prop.hFov = THREE.Math.radToDeg(2 * Math.atan(Math.tan(THREE.Math.degToRad(this.prop.vFov) / 2) * this.prop.aspect));
  this.needsUpdate();

  /**
   * @event zoom-updated
   * @memberof PhotoSphereViewer
   * @summary Triggered when the zoom level changes
   * @param {int} zoomLevel
   */
  this.trigger('zoom-updated', this.getZoomLevel());
};

/**
 * @summary Increases the zoom level by 1
 */
PhotoSphereViewer.prototype.zoomIn = function() {
  if (this.prop.zoom_lvl < 100) {
    this.zoom(this.prop.zoom_lvl + this.config.zoom_speed);
  }
};

/**
 * @summary Decreases the zoom level by 1
 */
PhotoSphereViewer.prototype.zoomOut = function() {
  if (this.prop.zoom_lvl > 0) {
    this.zoom(this.prop.zoom_lvl - this.config.zoom_speed);
  }
};

/**
 * @summary Resizes the viewer
 * @param {PhotoSphereViewer.CssSize} size
 */
PhotoSphereViewer.prototype.resize = function(size) {
  if (size.width) {
    this.container.style.width = size.width;
  }
  if (size.height) {
    this.container.style.height = size.height;
  }

  this._onResize();
};

PhotoSphereViewer.prototype.enterFullscreen = function() {
  PSVUtils.requestFullscreen(this.container);
};

PhotoSphereViewer.prototype.exitFullscreen = function() {
  PSVUtils.exitFullscreen();
};

/**
 * @summary Enters or exits the fullscreen mode
 */
PhotoSphereViewer.prototype.toggleFullscreen = function() {
  if (!this.isFullscreenEnabled()) {
    this.enterFullscreen();
  }
  else {
    this.exitFullscreen();
  }
};

/**
 * @summary Enables the keyboard controls (done automatically when entering fullscreen)
 */
PhotoSphereViewer.prototype.startKeyboardControl = function() {
  window.addEventListener('keydown', this);
};

/**
 * @summary Disables the keyboard controls (done automatically when exiting fullscreen)
 */
PhotoSphereViewer.prototype.stopKeyboardControl = function() {
  window.removeEventListener('keydown', this);
};

/**
 * @summary Preload a panorama file without displaying it
 * @param {string} panorama
 * @returns {Promise}
 * @throws {PSVError} when the cache is disabled
 */
PhotoSphereViewer.prototype.preloadPanorama = function(panorama) {
  if (!this.config.cache_texture) {
    throw new PSVError('Cannot preload panorama, cache_texture is disabled');
  }

  return this._loadTexture(panorama);
};

/**
 * @summary Removes a panorama from the cache or clears the entire cache
 * @param {string} [panorama]
 * @throws {PSVError} when the cache is disabled
 */
PhotoSphereViewer.prototype.clearPanoramaCache = function(panorama) {
  if (!this.config.cache_texture) {
    throw new PSVError('Cannot clear cache, cache_texture is disabled');
  }

  if (panorama) {
    for (var i = 0, l = this.prop.cache.length; i < l; i++) {
      if (this.prop.cache[i].panorama === panorama) {
        this.prop.cache.splice(i, 1);
        break;
      }
    }
  }
  else {
    this.prop.cache.length = 0;
  }
};

/**
 * @summary Retrieves the cache for a panorama
 * @param {string} panorama
 * @returns {PhotoSphereViewer.CacheItem}
 * @throws {PSVError} when the cache is disabled
 */
PhotoSphereViewer.prototype.getPanoramaCache = function(panorama) {
  if (!this.config.cache_texture) {
    throw new PSVError('Cannot query cache, cache_texture is disabled');
  }

  return this.prop.cache.filter(function(cache) {
    return cache.panorama === panorama;
  }).shift();
};


/**
 * @summary Inits the global SYSTEM var with generic support information
 * @private
 */
PhotoSphereViewer._loadSystem = function() {
  var S = PhotoSphereViewer.SYSTEM;
  S.loaded = true;
  S.pixelRatio = window.devicePixelRatio || 1;
  S.isWebGLSupported = PSVUtils.isWebGLSupported();
  S.isCanvasSupported = PSVUtils.isCanvasSupported();
  S.maxTextureWidth = S.isWebGLSupported ? PSVUtils.getMaxTextureWidth() : 4096;
  S.mouseWheelEvent = PSVUtils.mouseWheelEvent();
  S.fullscreenEvent = PSVUtils.fullscreenEvent();
  S.deviceOrientationSupported = PSVUtils.isDeviceOrientationSupported();
  S.touchEnabled = PSVUtils.isTouchEnabled();
};

/**
 * @summary Sets the viewer size
 * @param {PhotoSphereViewer.Size} size
 * @private
 */
PhotoSphereViewer.prototype._setViewerSize = function(size) {
  ['width', 'height'].forEach(function(dim) {
    if (size[dim]) {
      if (/^[0-9.]+$/.test(size[dim])) {
        size[dim] += 'px';
      }
      this.parent.style[dim] = size[dim];
    }
  }, this);
};

/**
 * @summary Converts pixel texture coordinates to spherical radians coordinates
 * @param {PhotoSphereViewer.Point} point
 * @returns {PhotoSphereViewer.Position}
 */
PhotoSphereViewer.prototype.textureCoordsToSphericalCoords = function(point) {
  if (this.prop.isCubemap) {
    throw new PSVError('Unable to use texture coords with cubemap.');
  }

  var relativeX = (point.x + this.prop.pano_data.cropped_x) / this.prop.pano_data.full_width * PSVUtils.TwoPI;
  var relativeY = (point.y + this.prop.pano_data.cropped_y) / this.prop.pano_data.full_height * Math.PI;

  return {
    longitude: relativeX >= Math.PI ? relativeX - Math.PI : relativeX + Math.PI,
    latitude: PSVUtils.HalfPI - relativeY
  };
};

/**
 * @summary Converts spherical radians coordinates to pixel texture coordinates
 * @param {PhotoSphereViewer.Position} position
 * @returns {PhotoSphereViewer.Point}
 */
PhotoSphereViewer.prototype.sphericalCoordsToTextureCoords = function(position) {
  if (this.prop.isCubemap) {
    throw new PSVError('Unable to use texture coords with cubemap.');
  }

  var relativeLong = position.longitude / PSVUtils.TwoPI * this.prop.pano_data.full_width;
  var relativeLat = position.latitude / Math.PI * this.prop.pano_data.full_height;

  return {
    x: parseInt(position.longitude < Math.PI ? relativeLong + this.prop.pano_data.full_width / 2 : relativeLong - this.prop.pano_data.full_width / 2) - this.prop.pano_data.cropped_x,
    y: parseInt(this.prop.pano_data.full_height / 2 - relativeLat) - this.prop.pano_data.cropped_y
  };
};

/**
 * @summary Converts spherical radians coordinates to a THREE.Vector3
 * @param {PhotoSphereViewer.Position} position
 * @returns {THREE.Vector3}
 */
PhotoSphereViewer.prototype.sphericalCoordsToVector3 = function(position) {
  return new THREE.Vector3(
    PhotoSphereViewer.SPHERE_RADIUS * -Math.cos(position.latitude) * Math.sin(position.longitude),
    PhotoSphereViewer.SPHERE_RADIUS * Math.sin(position.latitude),
    PhotoSphereViewer.SPHERE_RADIUS * Math.cos(position.latitude) * Math.cos(position.longitude)
  );
};

/**
 * @summary Converts a THREE.Vector3 to spherical radians coordinates
 * @param {THREE.Vector3} vector
 * @returns {PhotoSphereViewer.Position}
 */
PhotoSphereViewer.prototype.vector3ToSphericalCoords = function(vector) {
  var phi = Math.acos(vector.y / Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z));
  var theta = Math.atan2(vector.x, vector.z);

  return {
    longitude: theta < 0 ? -theta : PSVUtils.TwoPI - theta,
    latitude: PSVUtils.HalfPI - phi
  };
};

/**
 * @summary Converts position on the viewer to a THREE.Vector3
 * @param {PhotoSphereViewer.Point} viewerPoint
 * @returns {THREE.Vector3}
 */
PhotoSphereViewer.prototype.viewerCoordsToVector3 = function(viewerPoint) {
  var screen = new THREE.Vector2(
    2 * viewerPoint.x / this.prop.size.width - 1,
    -2 * viewerPoint.y / this.prop.size.height + 1
  );

  this.raycaster.setFromCamera(screen, this.camera);

  var intersects = this.raycaster.intersectObjects(this.scene.children);

  if (intersects.length === 1) {
    return intersects[0].point;
  }
  else {
    return null;
  }
};

/**
 * @summary Converts a THREE.Vector3 to position on the viewer
 * @param {THREE.Vector3} vector
 * @returns {PhotoSphereViewer.Point}
 */
PhotoSphereViewer.prototype.vector3ToViewerCoords = function(vector) {
  vector = vector.clone();
  vector.project(this.camera);

  return {
    x: parseInt((vector.x + 1) / 2 * this.prop.size.width),
    y: parseInt((1 - vector.y) / 2 * this.prop.size.height)
  };
};

/**
 * @summary Converts x/y to latitude/longitude if present and ensure boundaries
 * @param {PhotoSphereViewer.ExtendedPosition} position - mutated
 * @private
 */
PhotoSphereViewer.prototype.cleanPosition = function(position) {
  if (position.hasOwnProperty('x') && position.hasOwnProperty('y')) {
    PSVUtils.deepmerge(position, this.textureCoordsToSphericalCoords(position));
  }

  position.longitude = PSVUtils.parseAngle(position.longitude);
  position.latitude = PSVUtils.parseAngle(position.latitude, true);
};

/**
 * @summary Apply "longitude_range" and "latitude_range"
 * @param {PhotoSphereViewer.Position} position - mutated
 * @returns {string[]} list of sides that were reached
 * @private
 */
PhotoSphereViewer.prototype.applyRanges = function(position) {
  var range, offset, sidesReached = [];

  if (this.config.longitude_range) {
    range = PSVUtils.clone(this.config.longitude_range);
    offset = THREE.Math.degToRad(this.prop.hFov) / 2;

    range[0] = PSVUtils.parseAngle(range[0] + offset);
    range[1] = PSVUtils.parseAngle(range[1] - offset);

    if (range[0] > range[1]) { // when the range cross longitude 0
      if (position.longitude > range[1] && position.longitude < range[0]) {
        if (position.longitude > (range[0] / 2 + range[1] / 2)) { // detect which side we are closer too
          position.longitude = range[0];
          sidesReached.push('left');
        }
        else {
          position.longitude = range[1];
          sidesReached.push('right');
        }
      }
    }
    else {
      if (position.longitude < range[0]) {
        position.longitude = range[0];
        sidesReached.push('left');
      }
      else if (position.longitude > range[1]) {
        position.longitude = range[1];
        sidesReached.push('right');
      }
    }
  }

  if (this.config.latitude_range) {
    range = PSVUtils.clone(this.config.latitude_range);
    offset = THREE.Math.degToRad(this.prop.vFov) / 2;

    range[0] = PSVUtils.parseAngle(Math.min(range[0] + offset, range[1]), true);
    range[1] = PSVUtils.parseAngle(Math.max(range[1] - offset, range[0]), true);

    if (position.latitude < range[0]) {
      position.latitude = range[0];
      sidesReached.push('bottom');
    }
    else if (position.latitude > range[1]) {
      position.latitude = range[1];
      sidesReached.push('top');
    }
  }

  return sidesReached;
};


/**
 * @module components
 */

/**
 * Base sub-component class
 * @param {PhotoSphereViewer | module:components.PSVComponent} parent
 * @constructor
 * @memberof module:components
 */
function PSVComponent(parent) {
  /**
   * @member {PhotoSphereViewer}
   * @readonly
   */
  this.psv = parent instanceof PhotoSphereViewer ? parent : parent.psv;

  /**
   * @member {PhotoSphereViewer|module:components.PSVComponent}
   * @readonly
   */
  this.parent = parent;

  /**
   * @member {HTMLElement}
   * @readonly
   */
  this.container = null;

  /**
   * @summary Visibility of the component
   * @member {boolean}
   * @readonly
   */
  this.visible = true;

  // expose some methods to the viewer
  if (this.constructor.publicMethods) {
    this.constructor.publicMethods.forEach(function(method) {
      this.psv[method] = this[method].bind(this);
    }, this);
  }
}

/**
 * @summary CSS class added to the component's container
 * @member {string}
 * @readonly
 */
PSVComponent.className = null;

/**
 * @summary List of component's methods which are bound the the main viewer
 * @member {string[]}
 * @readonly
 */
PSVComponent.publicMethods = [];

/**
 * @summary Creates the component
 * @protected
 */
PSVComponent.prototype.create = function() {
  this.container = document.createElement('div');

  if (this.constructor.className) {
    this.container.className = this.constructor.className;
  }

  this.parent.container.appendChild(this.container);
};

/**
 * @summary Destroys the component
 * @protected
 */
PSVComponent.prototype.destroy = function() {
  this.parent.container.removeChild(this.container);

  if (this.constructor.publicMethods) {
    this.constructor.publicMethods.forEach(function(method) {
      delete this.psv[method];
    }, this);
  }

  delete this.container;
  delete this.psv;
  delete this.parent;
};

/**
 * @summary Hides the component
 * @protected
 */
PSVComponent.prototype.hide = function() {
  this.container.style.display = 'none';
  this.visible = false;
};

/**
 * @summary Displays the component
 * @protected
 */
PSVComponent.prototype.show = function() {
  this.container.style.display = '';
  this.visible = true;
};


/**
 * HUD class
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVHUD(psv) {
  PSVComponent.call(this, psv);

  /**
   * @member {SVGElement}
   * @readonly
   */
  this.svgContainer = null;

  /**
   * @summary All registered markers
   * @member {Object.<string, PSVMarker>}
   */
  this.markers = {};

  /**
   * @summary Last selected marker
   * @member {PSVMarker}
   * @readonly
   */
  this.currentMarker = null;

  /**
   * @summary Marker under the cursor
   * @member {PSVMarker}
   * @readonly
   */
  this.hoveringMarker = null;

  /**
   * @member {Object}
   * @private
   */
  this.prop = {
    panelOpened: false,
    panelOpening: false,
    markersButton: this.psv.navbar.getNavbarButton('markers', true)
  };

  this.create();
}

PSVHUD.prototype = Object.create(PSVComponent.prototype);
PSVHUD.prototype.constructor = PSVHUD;

PSVHUD.className = 'psv-hud';
PSVHUD.publicMethods = [
  'addMarker',
  'removeMarker',
  'updateMarker',
  'clearMarkers',
  'getMarker',
  'getCurrentMarker',
  'gotoMarker',
  'hideMarker',
  'showMarker',
  'toggleMarker',
  'toggleMarkersList',
  'showMarkersList',
  'hideMarkersList'
];

/**
 * @override
 */
PSVHUD.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.svgContainer = document.createElementNS(PSVUtils.svgNS, 'svg');
  this.svgContainer.setAttribute('class', 'psv-hud-svg-container');
  this.container.appendChild(this.svgContainer);

  // Markers events via delegation
  this.container.addEventListener('mouseenter', this, true);
  this.container.addEventListener('mouseleave', this, true);
  this.container.addEventListener('mousemove', this, true);

  // Viewer events
  this.psv.on('click', this);
  this.psv.on('dblclick', this);
  this.psv.on('render', this);
  this.psv.on('open-panel', this);
  this.psv.on('close-panel', this);
};

/**
 * @override
 */
PSVHUD.prototype.destroy = function() {
  this.clearMarkers(false);

  this.container.removeEventListener('mouseenter', this);
  this.container.removeEventListener('mouseleave', this);
  this.container.removeEventListener('mousemove', this);

  this.psv.off('click', this);
  this.psv.off('dblclick', this);
  this.psv.off('render', this);
  this.psv.off('open-panel', this);
  this.psv.off('close-panel', this);

  delete this.svgContainer;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVHUD.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'mouseenter':  this._onMouseEnter(e);        break;
    case 'mouseleave':  this._onMouseLeave(e);        break;
    case 'mousemove':   this._onMouseMove(e);         break;
    case 'click':       this._onClick(e.args[0], e, false); break;
    case 'dblclick':    this._onClick(e.args[0], e, true);  break;
    case 'render':      this.renderMarkers();         break;
    case 'open-panel':  this._onPanelOpened();        break;
    case 'close-panel': this._onPanelClosed();        break;
    // @formatter:on
  }
};

/**
 * @summary Adds a new marker to viewer
 * @param {Object} properties - see {@link http://photo-sphere-viewer.js.org/markers.html#config}
 * @param {boolean} [render=true] - renders the marker immediately
 * @returns {PSVMarker}
 * @throws {PSVError} when the marker's id is missing or already exists
 */
PSVHUD.prototype.addMarker = function(properties, render) {
  if (!properties.id) {
    throw new PSVError('missing marker id');
  }

  if (this.markers[properties.id]) {
    throw new PSVError('marker "' + properties.id + '" already exists');
  }

  var marker = new PSVMarker(properties, this.psv);

  if (marker.isNormal()) {
    this.container.appendChild(marker.$el);
  }
  else {
    this.svgContainer.appendChild(marker.$el);
  }

  this.markers[marker.id] = marker;

  if (render !== false) {
    this.renderMarkers();
  }

  return marker;
};

/**
 * @summary Returns the internal marker object for a marker id
 * @param {*} markerId
 * @returns {PSVMarker}
 * @throws {PSVError} when the marker cannot be found
 */
PSVHUD.prototype.getMarker = function(markerId) {
  var id = typeof markerId === 'object' ? markerId.id : markerId;

  if (!this.markers[id]) {
    throw new PSVError('cannot find marker "' + id + '"');
  }

  return this.markers[id];
};

/**
 * @summary Returns the last marker selected by the user
 * @returns {PSVMarker}
 */
PSVHUD.prototype.getCurrentMarker = function() {
  return this.currentMarker;
};

/**
 * @summary Updates the existing marker with the same id
 * @description Every property can be changed but you can't change its type (Eg: `image` to `html`).
 * @param {Object|PSVMarker} properties
 * @param {boolean} [render=true] - renders the marker immediately
 * @returns {PSVMarker}
 */
PSVHUD.prototype.updateMarker = function(properties, render) {
  var marker = this.getMarker(properties);

  marker.update(properties);

  if (render !== false) {
    this.renderMarkers();
  }

  return marker;
};

/**
 * @summary Removes a marker from the viewer
 * @param {*} marker
 * @param {boolean} [render=true] - renders the marker immediately
 */
PSVHUD.prototype.removeMarker = function(marker, render) {
  marker = this.getMarker(marker);

  if (marker.isNormal()) {
    this.container.removeChild(marker.$el);
  }
  else {
    this.svgContainer.removeChild(marker.$el);
  }

  if (this.hoveringMarker === marker) {
    this.psv.tooltip.hideTooltip();
  }

  marker.destroy();
  delete this.markers[marker.id];

  if (render !== false) {
    this.renderMarkers();
  }
};

/**
 * @summary Removes all markers
 * @param {boolean} [render=true] - renders the markers immediately
 */
PSVHUD.prototype.clearMarkers = function(render) {
  Object.keys(this.markers).forEach(function(marker) {
    this.removeMarker(marker, false);
  }, this);

  if (render !== false) {
    this.renderMarkers();
  }
};

/**
 * @summary Rotate the view to face the marker
 * @param {*} marker
 * @param {string|int} [duration] - rotates smoothy, see {@link PhotoSphereViewer#animate}
 * @fires module:components.PSVHUD.goto-marker-done
 * @return {Promise}  A promise that will be resolved when the animation finishes
 */
PSVHUD.prototype.gotoMarker = function(marker, duration) {
  marker = this.getMarker(marker);

  return this.psv.animate(marker, duration)
    .then(function() {
      /**
       * @event goto-marker-done
       * @memberof module:components.PSVHUD
       * @summary Triggered when the animation to a marker is done
       * @param {PSVMarker} marker
       */
      this.psv.trigger('goto-marker-done', marker);
    }.bind(this));
};

/**
 * @summary Hides a marker
 * @param {*} marker
 */
PSVHUD.prototype.hideMarker = function(marker) {
  this.getMarker(marker).visible = false;
  this.renderMarkers();
};

/**
 * @summary Shows a marker
 * @param {*} marker
 */
PSVHUD.prototype.showMarker = function(marker) {
  this.getMarker(marker).visible = true;
  this.renderMarkers();
};

/**
 * @summary Toggles a marker
 * @param {*} marker
 */
PSVHUD.prototype.toggleMarker = function(marker) {
  this.getMarker(marker).visible ^= true;
  this.renderMarkers();
};

/**
 * @summary Toggles the visibility of markers list
 */
PSVHUD.prototype.toggleMarkersList = function() {
  if (this.prop.panelOpened) {
    this.hideMarkersList();
  }
  else {
    this.showMarkersList();
  }
};

/**
 * @summary Opens side panel with list of markers
 * @fires module:components.PSVHUD.filter:render-markers-list
 */
PSVHUD.prototype.showMarkersList = function() {
  var markers = [];
  PSVUtils.forEach(this.markers, function(marker) {
    markers.push(marker);
  });

  /**
   * @event filter:render-markers-list
   * @memberof module:components.PSVHUD
   * @summary Used to alter the list of markers displayed on the side-panel
   * @param {PSVMarker[]} markers
   * @returns {PSVMarker[]}
   */
  var html = this.psv.config.templates.markersList({
    markers: this.psv.change('render-markers-list', markers),
    config: this.psv.config
  });

  this.prop.panelOpening = true;
  this.psv.panel.showPanel(html, true);

  this.psv.panel.container.querySelector('.psv-markers-list').addEventListener('click', this._onClickItem.bind(this));
};

/**
 * @summary Closes side panel if it contains the list of markers
 */
PSVHUD.prototype.hideMarkersList = function() {
  if (this.prop.panelOpened) {
    this.psv.panel.hidePanel();
  }
};

/**
 * @summary Updates the visibility and the position of all markers
 */
PSVHUD.prototype.renderMarkers = function() {
  if (!this.visible) {
    return;
  }

  var rotation = !this.psv.isGyroscopeEnabled() ? 0 : THREE.Math.radToDeg(this.psv.camera.rotation.z);

  PSVUtils.forEach(this.markers, function(marker) {
    var isVisible = marker.visible;

    if (isVisible && marker.isPoly()) {
      var positions = this._getPolyPositions(marker);
      isVisible = positions.length > (marker.isPolygon() ? 2 : 1);

      if (isVisible) {
        marker.position2D = this._getPolyDimensions(marker, positions);

        var points = positions.map(function(pos) {
          return pos.x + ',' + pos.y;
        }).join(' ');

        marker.$el.setAttributeNS(null, 'points', points);
      }
    }
    else if (isVisible) {
      var position = this._getMarkerPosition(marker);
      isVisible = this._isMarkerVisible(marker, position);

      if (isVisible) {
        marker.position2D = position;

        var scale = marker.getScale(this.psv.getZoomLevel());

        if (marker.isSvg()) {
          marker.$el.setAttributeNS(null, 'transform',
            'translate(' + position.x + ', ' + position.y + ')' +
            (scale !== 1 ? ' scale(' + scale + ', ' + scale + ')' : '') +
            (!marker.lockRotation && rotation ? ' rotate(' + rotation + ')' : '')
          );
        }
        else {
          marker.$el.style.transform = 'translate3D(' + position.x + 'px, ' + position.y + 'px, 0px)' +
            (scale !== 1 ? ' scale(' + scale + ', ' + scale + ')' : '') +
            (!marker.lockRotation && rotation ? ' rotateZ(' + rotation + 'deg)' : '');
        }
      }
    }

    PSVUtils.toggleClass(marker.$el, 'psv-marker--visible', isVisible);
  }.bind(this));
};

/**
 * @summary Determines if a point marker is visible<br>
 * It tests if the point is in the general direction of the camera, then check if it's in the viewport
 * @param {PSVMarker} marker
 * @param {PhotoSphereViewer.Point} position
 * @returns {boolean}
 * @private
 */
PSVHUD.prototype._isMarkerVisible = function(marker, position) {
  return marker.position3D.dot(this.psv.prop.direction) > 0 &&
    position.x + marker.width >= 0 &&
    position.x - marker.width <= this.psv.prop.size.width &&
    position.y + marker.height >= 0 &&
    position.y - marker.height <= this.psv.prop.size.height;
};

/**
 * @summary Computes HUD coordinates of a marker
 * @param {PSVMarker} marker
 * @returns {PhotoSphereViewer.Point}
 * @private
 */
PSVHUD.prototype._getMarkerPosition = function(marker) {
  if (marker._dynamicSize) {
    // make the marker visible to get it's size
    PSVUtils.toggleClass(marker.$el, 'psv-marker--transparent', true);
    var transform = marker.$el.style.transform;
    marker.$el.style.transform = null;

    var rect = marker.$el.getBoundingClientRect();

    marker.$el.style.transform = transform;
    PSVUtils.toggleClass(marker.$el, 'psv-marker--transparent', false);

    marker.width = rect.right - rect.left;
    marker.height = rect.bottom - rect.top;
  }

  var position = this.psv.vector3ToViewerCoords(marker.position3D);

  position.x -= marker.width * marker.anchor.left;
  position.y -= marker.height * marker.anchor.top;

  return position;
};

/**
 * @summary Computes HUD coordinates of each point of a polygon/polyline<br>
 * It handles points behind the camera by creating intermediary points suitable for the projector
 * @param {PSVMarker} marker
 * @returns {PhotoSphereViewer.Point[]}
 * @private
 */
PSVHUD.prototype._getPolyPositions = function(marker) {
  var nbVectors = marker.positions3D.length;

  // compute if each vector is visible
  var positions3D = marker.positions3D.map(function(vector) {
    return {
      vector: vector,
      visible: vector.dot(this.psv.prop.direction) > 0
    };
  }, this);

  // get pairs of visible/invisible vectors for each invisible vector connected to a visible vector
  var toBeComputed = [];
  positions3D.forEach(function(pos, i) {
    if (!pos.visible) {
      var neighbours = [
        i === 0 ? positions3D[nbVectors - 1] : positions3D[i - 1],
        i === nbVectors - 1 ? positions3D[0] : positions3D[i + 1]
      ];

      neighbours.forEach(function(neighbour) {
        if (neighbour.visible) {
          toBeComputed.push({
            visible: neighbour,
            invisible: pos,
            index: i
          });
        }
      });
    }
  });

  // compute intermediary vector for each pair (the loop is reversed for splice to insert at the right place)
  toBeComputed.reverse().forEach(function(pair) {
    positions3D.splice(pair.index, 0, {
      vector: this._getPolyIntermediaryPoint(pair.visible.vector, pair.invisible.vector),
      visible: true
    });
  }, this);

  // translate vectors to screen pos
  return positions3D
    .filter(function(pos) {
      return pos.visible;
    })
    .map(function(pos) {
      return this.psv.vector3ToViewerCoords(pos.vector);
    }, this);
};

/**
 * Given one point in the same direction of the camera and one point behind the camera,
 * computes an intermediary point on the great circle delimiting the half sphere visible by the camera.
 * The point is shifted by .01 rad because the projector cannot handle points exactly on this circle.
 * {@link http://math.stackexchange.com/a/1730410/327208}
 * @param P1 {THREE.Vector3}
 * @param P2 {THREE.Vector3}
 * @returns {THREE.Vector3}
 * @private
 */
PSVHUD.prototype._getPolyIntermediaryPoint = function(P1, P2) {
  var C = this.psv.prop.direction.clone().normalize();
  var N = new THREE.Vector3().crossVectors(P1, P2).normalize();
  var V = new THREE.Vector3().crossVectors(N, P1).normalize();
  var H = new THREE.Vector3().addVectors(P1.clone().multiplyScalar(-C.dot(V)), V.clone().multiplyScalar(C.dot(P1))).normalize();
  var a = new THREE.Vector3().crossVectors(H, C);
  return H.applyAxisAngle(a, 0.01).multiplyScalar(PhotoSphereViewer.SPHERE_RADIUS);
};

/**
 * @summary Computes the boundaries positions of a polygon/polyline marker
 * @param {PSVMarker} marker - alters width and height
 * @param {PhotoSphereViewer.Point[]} positions
 * @returns {PhotoSphereViewer.Point}
 * @private
 */
PSVHUD.prototype._getPolyDimensions = function(marker, positions) {
  var minX = +Infinity;
  var minY = +Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;

  positions.forEach(function(pos) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x);
    maxY = Math.max(maxY, pos.y);
  });

  marker.width = maxX - minX;
  marker.height = maxY - minY;

  return {
    x: minX,
    y: minY
  };
};

/**
 * @summary Handles mouse enter events, show the tooltip for non polygon markers
 * @param {MouseEvent} e
 * @fires module:components.PSVHUD.over-marker
 * @private
 */
PSVHUD.prototype._onMouseEnter = function(e) {
  var marker;
  if (e.target && (marker = e.target.psvMarker) && !marker.isPoly()) {
    this.hoveringMarker = marker;

    /**
     * @event over-marker
     * @memberof module:components.PSVHUD
     * @summary Triggered when the user puts the cursor hover a marker
     * @param {PSVMarker} marker
     */
    this.psv.trigger('over-marker', marker);

    if (marker.tooltip) {
      this.psv.tooltip.showTooltip({
        content: marker.tooltip.content,
        position: marker.tooltip.position,
        left: marker.position2D.x,
        top: marker.position2D.y,
        box: {
          width: marker.width,
          height: marker.height
        }
      });
    }
  }
};

/**
 * @summary Handles mouse leave events, hide the tooltip
 * @param {MouseEvent} e
 * @fires module:components.PSVHUD.leave-marker
 * @private
 */
PSVHUD.prototype._onMouseLeave = function(e) {
  var marker;
  if (e.target && (marker = e.target.psvMarker)) {
    // do not hide if we enter the tooltip itself while hovering a polygon
    if (marker.isPoly() && e.relatedTarget && PSVUtils.hasParent(e.relatedTarget, this.psv.tooltip.container)) {
      return;
    }

    /**
     * @event leave-marker
     * @memberof module:components.PSVHUD
     * @summary Triggered when the user puts the cursor away from a marker
     * @param {PSVMarker} marker
     */
    this.psv.trigger('leave-marker', marker);

    this.hoveringMarker = null;

    this.psv.tooltip.hideTooltip();
  }
};

/**
 * @summary Handles mouse move events, refresh the tooltip for polygon markers
 * @param {MouseEvent} e
 * @fires module:components.PSVHUD.leave-marker
 * @fires module:components.PSVHUD.over-marker
 * @private
 */
PSVHUD.prototype._onMouseMove = function(e) {
  if (!this.psv.prop.moving) {
    var marker;

    // do not hide if we enter the tooltip itself while hovering a polygon
    if (e.target && (marker = e.target.psvMarker) && marker.isPoly() ||
      e.target && PSVUtils.hasParent(e.target, this.psv.tooltip.container) && (marker = this.hoveringMarker)) {

      if (!this.hoveringMarker) {
        this.psv.trigger('over-marker', marker);

        this.hoveringMarker = marker;
      }

      var boundingRect = this.psv.container.getBoundingClientRect();

      if (marker.tooltip) {
        this.psv.tooltip.showTooltip({
          content: marker.tooltip.content,
          position: marker.tooltip.position,
          top: e.clientY - boundingRect.top - this.psv.config.tooltip.arrow_size / 2,
          left: e.clientX - boundingRect.left - this.psv.config.tooltip.arrow_size,
          box: { // separate the tooltip from the cursor
            width: this.psv.config.tooltip.arrow_size * 2,
            height: this.psv.config.tooltip.arrow_size * 2
          }
        });
      }
    }
    else if (this.hoveringMarker && this.hoveringMarker.isPoly()) {
      this.psv.trigger('leave-marker', this.hoveringMarker);

      this.hoveringMarker = null;

      this.psv.tooltip.hideTooltip();
    }
  }
};

/**
 * @summary Handles mouse click events, select the marker and open the panel if necessary
 * @param {Object} data
 * @param {Event} e
 * @param {boolean} dblclick
 * @fires module:components.PSVHUD.select-marker
 * @fires module:components.PSVHUD.unselect-marker
 * @private
 */
PSVHUD.prototype._onClick = function(data, e, dblclick) {
  var marker;
  if (data.target && (marker = PSVUtils.getClosest(data.target, '.psv-marker')) && marker.psvMarker) {
    this.currentMarker = marker.psvMarker;

    /**
     * @event select-marker
     * @memberof module:components.PSVHUD
     * @summary Triggered when the user clicks on a marker. The marker can be retrieved from outside the event handler
     * with {@link module:components.PSVHUD.getCurrentMarker}
     * @param {PSVMarker} marker
     * @param {boolean} dblclick - the simple click is always fired before the double click
     */
    this.psv.trigger('select-marker', this.currentMarker, dblclick);

    if (this.psv.config.click_event_on_marker) {
      // add the marker to event data
      data.marker = marker.psvMarker;
    }
    else {
      e.stopPropagation();
    }
  }
  else if (this.currentMarker) {
    /**
     * @event unselect-marker
     * @memberof module:components.PSVHUD
     * @summary Triggered when a marker was selected and the user clicks elsewhere
     * @param {PSVMarker} marker
     */
    this.psv.trigger('unselect-marker', this.currentMarker);

    this.currentMarker = null;
  }

  if (marker && marker.psvMarker && marker.psvMarker.content) {
    this.psv.panel.showPanel(marker.psvMarker.content);
  }
  else if (this.psv.panel.prop.opened) {
    e.stopPropagation();
    this.psv.panel.hidePanel();
  }
};

/**
 * @summary Clicks on an item
 * @param {MouseEvent} e
 * @fires module:components.PSVHUD.select-marker-list
 * @private
 */
PSVHUD.prototype._onClickItem = function(e) {
  var li;
  if (e.target && (li = PSVUtils.getClosest(e.target, 'li')) && li.dataset.psvMarker) {
    var marker = this.getMarker(li.dataset.psvMarker);

    /**
     * @event select-marker-list
     * @memberof module:components.PSVHUD
     * @summary Triggered when a marker is selected from the side panel
     * @param {PSVMarker} marker
     */
    this.psv.trigger('select-marker-list', marker);

    this.gotoMarker(marker, 1000);
    this.psv.panel.hidePanel();
  }
};

/**
 * @summary Updates status when the panel is updated
 * @private
 */
PSVHUD.prototype._onPanelOpened = function() {
  if (this.prop.panelOpening) {
    this.prop.panelOpening = false;
    this.prop.panelOpened = true;
  }
  else {
    this.prop.panelOpened = false;
  }

  if (this.prop.markersButton) {
    this.prop.markersButton.toggleActive(this.prop.panelOpened);
  }
};

/**
 * @summary Updates status when the panel is updated
 * @private
 */
PSVHUD.prototype._onPanelClosed = function() {
  this.prop.panelOpened = false;
  this.prop.panelOpening = false;

  if (this.prop.markersButton) {
    this.prop.markersButton.toggleActive(false);
  }
};


/**
 * Loader class
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVLoader(psv) {
  PSVComponent.call(this, psv);

  /**
   * @summary Animation canvas
   * @member {HTMLCanvasElement}
   * @readonly
   * @private
   */
  this.canvas = null;

  /**
   * @summary Inner container for vertical center
   * @member {HTMLElement}
   * @readonly
   * @private
   */
  this.loader = null;

  this.create();
}

PSVLoader.prototype = Object.create(PSVComponent.prototype);
PSVLoader.prototype.constructor = PSVLoader;

PSVLoader.className = 'psv-loader-container';

/**
 * @override
 */
PSVLoader.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  var pixelRatio = PhotoSphereViewer.SYSTEM.pixelRatio;

  this.loader = document.createElement('div');
  this.loader.className = 'psv-loader';
  this.container.appendChild(this.loader);

  this.canvas = document.createElement('canvas');
  this.canvas.className = 'psv-loader-canvas';

  this.canvas.width = this.loader.clientWidth * pixelRatio;
  this.canvas.height = this.loader.clientWidth * pixelRatio;
  this.loader.appendChild(this.canvas);

  this.tickness = (this.loader.offsetWidth - this.loader.clientWidth) / 2 * pixelRatio;

  var inner;
  if (this.psv.config.loading_img) {
    inner = document.createElement('img');
    inner.className = 'psv-loader-image';
    inner.src = this.psv.config.loading_img;
  }
  else if (this.psv.config.loading_txt) {
    inner = document.createElement('div');
    inner.className = 'psv-loader-text';
    inner.innerHTML = this.psv.config.loading_txt;
  }
  if (inner) {
    var a = Math.round(Math.sqrt(2 * Math.pow((this.canvas.width / 2 - this.tickness / 2) / pixelRatio, 2)));
    inner.style.maxWidth = a + 'px';
    inner.style.maxHeight = a + 'px';
    this.loader.appendChild(inner);
  }
};

/**
 * @override
 */
PSVLoader.prototype.destroy = function() {
  delete this.loader;
  delete this.canvas;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Sets the loader progression
 * @param {int} value - from 0 to 100
 */
PSVLoader.prototype.setProgress = function(value) {
  var context = this.canvas.getContext('2d');

  context.clearRect(0, 0, this.canvas.width, this.canvas.height);

  context.lineWidth = this.tickness;
  context.strokeStyle = PSVUtils.getStyle(this.loader, 'color');

  context.beginPath();
  context.arc(
    this.canvas.width / 2, this.canvas.height / 2,
    this.canvas.width / 2 - this.tickness / 2,
    -Math.PI / 2, value / 100 * 2 * Math.PI - Math.PI / 2
  );
  context.stroke();
};


/**
 * Navigation bar class
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVNavBar(psv) {
  PSVComponent.call(this, psv);

  /**
   * @member {Object}
   * @readonly
   * @private
   */
  this.config = this.psv.config.navbar;

  /**
   * @summary List of buttons of the navbar
   * @member {Array.<module:components/buttons.PSVNavBarButton>}
   * @readonly
   */
  this.items = [];

  // all buttons
  if (this.config === true) {
    this.config = PSVUtils.clone(PhotoSphereViewer.DEFAULTS.navbar);
  }
  // space separated list
  else if (typeof this.config === 'string') {
    this.config = this.config.split(' ');
  }
  // migration from object
  else if (!Array.isArray(this.config)) {
    console.warn('PhotoSphereViewer: hashmap form of "navbar" is deprecated, use an array instead.');

    var config = this.config;
    this.config = [];

    PSVUtils.forEach(config, function(enabled, key) {
      if (enabled) {
        this.config.push(key);
      }
    }.bind(this));

    this.config.sort(function(a, b) {
      return PhotoSphereViewer.DEFAULTS.navbar.indexOf(a) - PhotoSphereViewer.DEFAULTS.navbar.indexOf(b);
    });
  }

  this.create();
}

PSVNavBar.prototype = Object.create(PSVComponent.prototype);
PSVNavBar.prototype.constructor = PSVNavBar;

PSVNavBar.className = 'psv-navbar psv-navbar--open';
PSVNavBar.publicMethods = ['showNavbar', 'hideNavbar', 'toggleNavbar', 'getNavbarButton'];

/**
 * @override
 * @throws {PSVError} when the configuration is incorrect
 */
PSVNavBar.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.config.forEach(function(button) {
    if (typeof button === 'object') {
      this.items.push(new PSVNavBarCustomButton(this, button));
    }
    else {
      switch (button) {
        case PSVNavBarAutorotateButton.id:
          this.items.push(new PSVNavBarAutorotateButton(this));
          break;

        case PSVNavBarZoomButton.id:
          this.items.push(new PSVNavBarZoomButton(this));
          break;

        case PSVNavBarDownloadButton.id:
          this.items.push(new PSVNavBarDownloadButton(this));
          break;

        case PSVNavBarMarkersButton.id:
          this.items.push(new PSVNavBarMarkersButton(this));
          break;

        case PSVNavBarFullscreenButton.id:
          this.items.push(new PSVNavBarFullscreenButton(this));
          break;

        case PSVNavBarStereoButton.id:
          this.items.push(new PSVNavBarStereoButton(this));
          break;

        case PSVNavBarGyroscopeButton.id:
          this.items.push(new PSVNavBarGyroscopeButton(this));
          break;

        case 'caption':
          this.items.push(new PSVNavBarCaption(this, this.psv.config.caption));
          break;

        /* falls through */
        default:
          if (button.indexOf('spacer') === 0) {
            console.warn('PhotoSphereViewer: navbar spacers have been removed.');
          }
          else {
            throw new PSVError('Unknown button ' + button);
          }
          break;
      }
    }
  }, this);
};

/**
 * @override
 */
PSVNavBar.prototype.destroy = function() {
  this.items.forEach(function(item) {
    item.destroy();
  });

  this.items.length = 0;
  delete this.config;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Returns a button by its identifier
 * @param {string} id
 * @param {boolean} [silent=false]
 * @returns {module:components/buttons.PSVNavBarButton}
 */
PSVNavBar.prototype.getNavbarButton = function(id, silent) {
  var button = null;

  this.items.some(function(item) {
    if (item.id === id) {
      button = item;
      return true;
    }
    else {
      return false;
    }
  });

  if (!button && !silent) {
    console.warn('PhotoSphereViewer: button "' + id + '" not found in the navbar.');
  }

  return button;
};

/**
 * @summary Shows the navbar
 */
PSVNavBar.prototype.showNavbar = function() {
  this.toggleNavbar(true);
};

/**
 * @summary Hides the navbar
 */
PSVNavBar.prototype.hideNavbar = function() {
  this.toggleNavbar(false);
};

/**
 * @summary Toggles the navbar
 * @param {boolean} active
 */
PSVNavBar.prototype.toggleNavbar = function(active) {
  PSVUtils.toggleClass(this.container, 'psv-navbar--open', active);
};


/**
 * Navbar caption class
 * @param {PSVNavBar} navbar
 * @param {string} caption
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVNavBarCaption(navbar, caption) {
  PSVComponent.call(this, navbar);

  /**
   * @member {HTMLElement}
   * @readonly
   * @private
   */
  this.content = null;

  /**
   * @member {SVGElement}
   * @readonly
   * @private
   */
  this.icon = null;

  /**
   * @member {Object}
   * @private
   */
  this.prop = {
    caption: '',
    width: 0,
    hidden: false
  };

  this.create();

  this.setCaption(caption);
}

PSVNavBarCaption.prototype = Object.create(PSVComponent.prototype);
PSVNavBarCaption.prototype.constructor = PSVNavBarCaption;

PSVNavBarCaption.className = 'psv-caption';
PSVNavBarCaption.publicMethods = ['setCaption'];

/**
 * @override
 */
PSVNavBarCaption.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.container.innerHTML = PhotoSphereViewer.ICONS['info.svg'];
  this.icon = this.container.querySelector('svg');
  this.icon.setAttribute('class', 'psv-caption-icon');
  this.icon.style.display = 'none';

  this.content = document.createElement('span');
  this.content.className = 'psv-caption-content';
  this.container.appendChild(this.content);

  this.icon.addEventListener('click', this);
  window.addEventListener('resize', this);
};

/**
 * @override
 */
PSVNavBarCaption.prototype.destroy = function() {
  window.removeEventListener('resize', this);

  delete this.content;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVNavBarCaption.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'resize': this._onResize(); break;
    case 'click':  this._onClick();  break;
    // @formatter:on
  }
};

/**
 * @summary Sets the bar caption
 * @param {string} html
 */
PSVNavBarCaption.prototype.setCaption = function(html) {
  if (!html) {
    this.prop.caption = '';
  }
  else {
    this.prop.caption = html;
  }

  this.content.innerHTML = this.prop.caption;

  this.content.style.display = '';
  this.prop.width = this.content.offsetWidth;

  this._onResize();
};

/**
 * @summary Toggles content and icon deending on available space
 * @private
 */
PSVNavBarCaption.prototype._onResize = function() {
  var width = parseInt(PSVUtils.getStyle(this.container, 'width')); // get real inner width

  if (width >= this.prop.width) {
    this.icon.style.display = 'none';
    this.content.style.display = '';
  }
  else {
    this.icon.style.display = '';
    this.content.style.display = 'none';
  }
};

/**
 * @summary Display caption as notification
 * @private
 */
PSVNavBarCaption.prototype._onClick = function() {
  if (this.psv.isNotificationVisible()) {
    this.psv.hideNotification();
  }
  else {
    this.psv.showNotification(this.prop.caption);
  }
};


/**
 * Notification class
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVNotification(psv) {
  PSVComponent.call(this, psv);

  this.create();
}

PSVNotification.prototype = Object.create(PSVComponent.prototype);
PSVNotification.prototype.constructor = PSVNotification;

PSVNotification.className = 'psv-notification';
PSVNotification.publicMethods = ['showNotification', 'hideNotification', 'isNotificationVisible'];

/**
 * @override
 */
PSVNotification.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.content = document.createElement('div');
  this.content.className = 'psv-notification-content';

  this.container.appendChild(this.content);

  this.content.addEventListener('click', this.hideNotification.bind(this));
};

/**
 * @override
 */
PSVNotification.prototype.destroy = function() {
  delete this.content;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Checks if the notification is visible
 * @returns {boolean}
 */
PSVNotification.prototype.isNotificationVisible = function() {
  return this.container.classList.contains('psv-notification--visible');
};

/**
 * @summary Displays a notification on the viewer
 * @param {Object|string} config
 * @param {string} config.content
 * @param {int} [config.timeout]
 *
 * @example
 * viewer.showNotification({ content: 'Hello world', timeout: 5000})
 * viewer.showNotification('Hello world')
 */
PSVNotification.prototype.showNotification = function(config) {
  if (typeof config === 'string') {
    config = {
      content: config
    };
  }

  this.content.innerHTML = config.content;

  this.container.classList.add('psv-notification--visible');

  /**
   * @event show-notification
   * @memberof module:components.PSVNotification
   * @summary Trigered when the notification is shown
   */
  this.psv.trigger('show-notification');

  if (config.timeout) {
    setTimeout(this.hideNotification.bind(this), config.timeout);
  }
};

/**
 * @summary Hides the notification
 * @fires module:components.PSVNotification.hide-notification
 */
PSVNotification.prototype.hideNotification = function() {
  if (this.isNotificationVisible()) {
    this.container.classList.remove('psv-notification--visible');

    /**
     * @event hide-notification
     * @memberof module:components.PSVNotification
     * @summary Trigered when the notification is hidden
     */
    this.psv.trigger('hide-notification');
  }
};


/**
 * Panel class
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVPanel(psv) {
  PSVComponent.call(this, psv);

  /**
   * @summary Content container
   * @member {HTMLElement}
   * @readonly
   * @private
   */
  this.content = null;

  /**
   * @member {Object}
   * @private
   */
  this.prop = {
    mouse_x: 0,
    mouse_y: 0,
    mousedown: false,
    opened: false
  };

  this.create();
}

PSVPanel.prototype = Object.create(PSVComponent.prototype);
PSVPanel.prototype.constructor = PSVPanel;

PSVPanel.className = 'psv-panel';
PSVPanel.publicMethods = ['showPanel', 'hidePanel'];

/**
 * @override
 */
PSVPanel.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.container.innerHTML =
    '<div class="psv-panel-resizer"></div>' +
    '<div class="psv-panel-close-button"></div>' +
    '<div class="psv-panel-content"></div>';

  this.content = this.container.querySelector('.psv-panel-content');

  var closeBtn = this.container.querySelector('.psv-panel-close-button');
  closeBtn.addEventListener('click', this.hidePanel.bind(this));

  // Stop event bubling from panel
  if (this.psv.config.mousewheel) {
    this.container.addEventListener(PhotoSphereViewer.SYSTEM.mouseWheelEvent, function(e) {
      e.stopPropagation();
    });
  }

  // Event for panel resizing + stop bubling
  var resizer = this.container.querySelector('.psv-panel-resizer');
  resizer.addEventListener('mousedown', this);
  resizer.addEventListener('touchstart', this);
  this.psv.container.addEventListener('mouseup', this);
  this.psv.container.addEventListener('touchend', this);
  this.psv.container.addEventListener('mousemove', this);
  this.psv.container.addEventListener('touchmove', this);
};

/**
 * @override
 */
PSVPanel.prototype.destroy = function() {
  this.psv.container.removeEventListener('mousemove', this);
  this.psv.container.removeEventListener('touchmove', this);
  this.psv.container.removeEventListener('mouseup', this);
  this.psv.container.removeEventListener('touchend', this);

  delete this.prop;
  delete this.content;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVPanel.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'mousedown': this._onMouseDown(e); break;
    case 'touchstart': this._onTouchStart(e); break;
    case 'mousemove': this._onMouseMove(e); break;
    case 'touchmove': this._onTouchMove(e); break;
    case 'mouseup': this._onMouseUp(e); break;
    case 'touchend': this._onMouseUp(e); break;
    // @formatter:on
  }
};

/**
 * @summary Shows the panel
 * @param {string} content
 * @param {boolean} [noMargin=false]
 * @fires module:components.PSVPanel.open-panel
 */
PSVPanel.prototype.showPanel = function(content, noMargin) {
  this.content.innerHTML = content;
  this.content.scrollTop = 0;
  this.container.classList.add('psv-panel--open');

  PSVUtils.toggleClass(this.content, 'psv-panel-content--no-margin', noMargin === true);

  this.prop.opened = true;

  /**
   * @event open-panel
   * @memberof module:components.PSVPanel
   * @summary Triggered when the panel is opened
   */
  this.psv.trigger('open-panel');
};

/**
 * @summary Hides the panel
 * @fires module:components.PSVPanel.close-panel
 */
PSVPanel.prototype.hidePanel = function() {
  this.content.innerHTML = null;
  this.prop.opened = false;
  this.container.classList.remove('psv-panel--open');

  /**
   * @event close-panel
   * @memberof module:components.PSVPanel
   * @summary Trigered when the panel is closed
   */
  this.psv.trigger('close-panel');
};

/**
 * @summary Handles mouse down events
 * @param {MouseEvent} evt
 * @private
 */
PSVPanel.prototype._onMouseDown = function(evt) {
  evt.stopPropagation();
  this._startResize(evt);
};

/**
 * @summary Handles touch events
 * @param {TouchEvent} evt
 * @private
 */
PSVPanel.prototype._onTouchStart = function(evt) {
  evt.stopPropagation();
  this._startResize(evt.changedTouches[0]);
};

/**
 * @summary Handles mouse up events
 * @param {MouseEvent} evt
 * @private
 */
PSVPanel.prototype._onMouseUp = function(evt) {
  if (this.prop.mousedown) {
    evt.stopPropagation();
    this.prop.mousedown = false;
    this.content.classList.remove('psv-panel-content--no-interaction');
  }
};

/**
 * @summary Handles mouse move events
 * @param {MouseEvent} evt
 * @private
 */
PSVPanel.prototype._onMouseMove = function(evt) {
  if (this.prop.mousedown) {
    evt.stopPropagation();
    this._resize(evt);
  }
};

/**
 * @summary Handles touch move events
 * @param {TouchEvent} evt
 * @private
 */
PSVPanel.prototype._onTouchMove = function(evt) {
  if (this.prop.mousedown) {
    this._resize(evt.touches[0]);
  }
};

/**
 * @summary Initializes the panel resize
 * @param {MouseEvent|Touch} evt
 * @private
 */
PSVPanel.prototype._startResize = function(evt) {
  this.prop.mouse_x = parseInt(evt.clientX);
  this.prop.mouse_y = parseInt(evt.clientY);
  this.prop.mousedown = true;
  this.content.classList.add('psv-panel-content--no-interaction');
};

/**
 * @summary Resizes the panel
 * @param {MouseEvent|Touch} evt
 * @private
 */
PSVPanel.prototype._resize = function(evt) {
  var x = parseInt(evt.clientX);
  var y = parseInt(evt.clientY);

  this.container.style.width = (this.container.offsetWidth - (x - this.prop.mouse_x)) + 'px';

  this.prop.mouse_x = x;
  this.prop.mouse_y = y;
};


/**
 * "Please rotate" class
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVPleaseRotate(psv) {
  PSVComponent.call(this, psv);

  this.create();
}

PSVPleaseRotate.prototype = Object.create(PSVComponent.prototype);
PSVPleaseRotate.prototype.constructor = PSVPleaseRotate;

PSVPleaseRotate.className = 'psv-please-rotate';

/**
 * @override
 */
PSVPleaseRotate.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.container.innerHTML =
    '<div class="psv-please-rotate-image">' + PhotoSphereViewer.ICONS['mobile-rotate.svg'] + '</div>' +
    '<div class="psv-please-rotate-text">' + this.psv.config.lang.please_rotate[0] + '</div>' +
    '<div class="psv-please-rotate-subtext">' + this.psv.config.lang.please_rotate[1] + '</div>';

  this.container.addEventListener('click', this);
  window.addEventListener('orientationchange', this);
};

/**
 * @override
 */
PSVPleaseRotate.prototype.destroy = function() {
  window.removeEventListener('orientationchange', this);

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVPleaseRotate.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'click': this.hide(); break;
    case 'orientationchange':
      if (Math.abs(window.orientation) === 90) {
        this.hide();
      }
      break;
    // @formatter:on
  }
};



/**
 * Tooltip class
 * @param {module:components.PSVHUD} hud
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components
 */
function PSVTooltip(hud) {
  PSVComponent.call(this, hud);

  /**
   * @member {Object}
   * @readonly
   * @private
   */
  this.config = this.psv.config.tooltip;

  /**
   * @member {Object}
   * @private
   */
  this.prop = {
    timeout: null
  };

  this.create();
}

PSVTooltip.prototype = Object.create(PSVComponent.prototype);
PSVTooltip.prototype.constructor = PSVTooltip;

PSVTooltip.className = 'psv-tooltip';
PSVTooltip.publicMethods = ['showTooltip', 'hideTooltip', 'isTooltipVisible'];

PSVTooltip.leftMap = { 0: 'left', 0.5: 'center', 1: 'right' };
PSVTooltip.topMap = { 0: 'top', 0.5: 'center', 1: 'bottom' };

/**
 * @override
 */
PSVTooltip.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  this.container.innerHTML = '<div class="psv-tooltip-arrow"></div><div class="psv-tooltip-content"></div>';
  this.container.style.top = '-1000px';
  this.container.style.left = '-1000px';

  this.content = this.container.querySelector('.psv-tooltip-content');
  this.arrow = this.container.querySelector('.psv-tooltip-arrow');

  this.psv.on('render', this);
};

/**
 * @override
 */
PSVTooltip.prototype.destroy = function() {
  this.psv.off('render', this);

  delete this.config;
  delete this.prop;

  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVTooltip.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'render': this.hideTooltip(); break;
    // @formatter:on
  }
};

/**
 * @summary Checks if the tooltip is visible
 * @returns {boolean}
 */
PSVTooltip.prototype.isTooltipVisible = function() {
  return this.container.classList.contains('psv-tooltip--visible');
};

/**
 * @summary Displays a tooltip on the viewer
 * @param {Object} config
 * @param {string} config.content - HTML content of the tootlip
 * @param {int} config.top - Position of the tip of the arrow of the tooltip, in pixels
 * @param {int} config.left - Position of the tip of the arrow of the tooltip, in pixels
 * @param {string} [config.position='top center'] - Tooltip position toward it's arrow tip.
 *                                                  Accepted values are combinations of `top`, `center`, `bottom`
 *                                                  and `left`, `center`, `right`
 * @param {string} [config.className] - Additional CSS class added to the tooltip
 * @param {Object} [config.box] - Used when displaying a tooltip on a marker
 * @param {int} [config.box.width=0]
 * @param {int} [config.box.height=0]
 * @fires module:components.PSVTooltip.show-tooltip
 * @throws {PSVError} when the configuration is incorrect
 *
 * @example
 * viewer.showTooltip({ content: 'Hello world', top: 200, left: 450, position: 'center bottom'})
 */
PSVTooltip.prototype.showTooltip = function(config) {
  if (this.prop.timeout) {
    window.clearTimeout(this.prop.timeout);
    this.prop.timeout = null;
  }

  var isUpdate = this.isTooltipVisible();
  var t = this.container;
  var c = this.content;
  var a = this.arrow;

  if (!config.position) {
    config.position = ['top', 'center'];
  }

  if (!config.box) {
    config.box = {
      width: 0,
      height: 0
    };
  }

  // parse position
  if (typeof config.position === 'string') {
    var tempPos = PSVUtils.parsePosition(config.position);

    if (!(tempPos.left in PSVTooltip.leftMap) || !(tempPos.top in PSVTooltip.topMap)) {
      throw new PSVError('unable to parse tooltip position "' + config.position + '"');
    }

    config.position = [PSVTooltip.topMap[tempPos.top], PSVTooltip.leftMap[tempPos.left]];
  }

  if (config.position[0] === 'center' && config.position[1] === 'center') {
    throw new PSVError('unable to parse tooltip position "center center"');
  }

  if (isUpdate) {
    // Remove every other classes (Firefox does not implements forEach)
    for (var i = t.classList.length - 1; i >= 0; i--) {
      var item = t.classList.item(i);
      if (item !== 'psv-tooltip' && item !== 'psv-tooltip--visible') {
        t.classList.remove(item);
      }
    }
  }
  else {
    t.className = 'psv-tooltip'; // reset the class
  }

  if (config.className) {
    PSVUtils.addClasses(t, config.className);
  }

  c.innerHTML = config.content;
  t.style.top = '0px';
  t.style.left = '0px';

  // compute size
  var rect = t.getBoundingClientRect();
  var style = {
    posClass: config.position.slice(),
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    top: 0,
    left: 0,
    arrow_top: 0,
    arrow_left: 0
  };

  // set initial position
  this._computeTooltipPosition(style, config);

  // correct position if overflow
  var refresh = false;
  if (style.top < this.config.offset) {
    style.posClass[0] = 'bottom';
    refresh = true;
  }
  else if (style.top + style.height > this.psv.prop.size.height - this.config.offset) {
    style.posClass[0] = 'top';
    refresh = true;
  }
  if (style.left < this.config.offset) {
    style.posClass[1] = 'right';
    refresh = true;
  }
  else if (style.left + style.width > this.psv.prop.size.width - this.config.offset) {
    style.posClass[1] = 'left';
    refresh = true;
  }
  if (refresh) {
    this._computeTooltipPosition(style, config);
  }

  // apply position
  t.style.top = style.top + 'px';
  t.style.left = style.left + 'px';

  a.style.top = style.arrow_top + 'px';
  a.style.left = style.arrow_left + 'px';

  t.classList.add('psv-tooltip--' + style.posClass.join('-'));

  // delay for correct transition between the two classes
  if (!isUpdate) {
    this.prop.timeout = window.setTimeout(function() {
      t.classList.add('psv-tooltip--visible');
      this.prop.timeout = null;

      /**
       * @event show-tooltip
       * @memberof module:components.PSVTooltip
       * @summary Trigered when the tooltip is shown
       */
      this.psv.trigger('show-tooltip');
    }.bind(this), this.config.delay);
  }
};

/**
 * @summary Hides the tooltip
 * @fires module:components.PSVTooltip.hide-tooltip
 */
PSVTooltip.prototype.hideTooltip = function() {
  if (this.prop.timeout) {
    window.clearTimeout(this.prop.timeout);
    this.prop.timeout = null;
  }

  if (this.isTooltipVisible()) {
    this.container.classList.remove('psv-tooltip--visible');

    this.prop.timeout = window.setTimeout(function() {
      this.content.innerHTML = null;
      this.container.style.top = '-1000px';
      this.container.style.left = '-1000px';
      this.prop.timeout = null;
    }.bind(this), this.config.delay);

    /**
     * @event hide-tooltip
     * @memberof module:components.PSVTooltip
     * @summary Trigered when the tooltip is hidden
     */
    this.psv.trigger('hide-tooltip');
  }
};

/**
 * @summary Computes the position of the tooltip and its arrow
 * @param {Object} style
 * @param {Object} config
 * @private
 */
PSVTooltip.prototype._computeTooltipPosition = function(style, config) {
  var topBottom = false;

  switch (style.posClass[0]) {
    case 'bottom':
      style.top = config.top + config.box.height + this.config.offset + this.config.arrow_size;
      style.arrow_top = -this.config.arrow_size * 2;
      topBottom = true;
      break;

    case 'center':
      style.top = config.top + config.box.height / 2 - style.height / 2;
      style.arrow_top = style.height / 2 - this.config.arrow_size;
      break;

    case 'top':
      style.top = config.top - style.height - this.config.offset - this.config.arrow_size;
      style.arrow_top = style.height;
      topBottom = true;
      break;
  }

  switch (style.posClass[1]) {
    case 'right':
      if (topBottom) {
        style.left = config.left + config.box.width / 2 - this.config.offset - this.config.arrow_size;
        style.arrow_left = this.config.offset;
      }
      else {
        style.left = config.left + config.box.width + this.config.offset + this.config.arrow_size;
        style.arrow_left = -this.config.arrow_size * 2;
      }
      break;

    case 'center':
      style.left = config.left + config.box.width / 2 - style.width / 2;
      style.arrow_left = style.width / 2 - this.config.arrow_size;
      break;

    case 'left':
      if (topBottom) {
        style.left = config.left - style.width + config.box.width / 2 + this.config.offset + this.config.arrow_size;
        style.arrow_left = style.width - this.config.offset - this.config.arrow_size * 2;
      }
      else {
        style.left = config.left - style.width - this.config.offset - this.config.arrow_size;
        style.arrow_left = style.width;
      }
      break;
  }
};


/**
 * @module components/buttons
 */

/**
 * Navigation bar button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components.PSVComponent
 * @memberof module:components/buttons
 */
function PSVNavBarButton(navbar) {
  PSVComponent.call(this, navbar);

  /**
   * @summary Unique identifier of the button
   * @member {string}
   * @readonly
   */
  this.id = undefined;

  if (this.constructor.id) {
    this.id = this.constructor.id;
  }

  /**
   * @summary State of the button
   * @member {boolean}
   * @readonly
   */
  this.enabled = true;
}

PSVNavBarButton.prototype = Object.create(PSVComponent.prototype);
PSVNavBarButton.prototype.constructor = PSVNavBarButton;

/**
 * @summary Unique identifier of the button
 * @member {string}
 * @readonly
 */
PSVNavBarButton.id = null;

/**
 * @summary SVG icon name injected in the button
 * @member {string}
 * @readonly
 */
PSVNavBarButton.icon = null;

/**
 * @summary SVG icon name injected in the button when it is active
 * @member {string}
 * @readonly
 */
PSVNavBarButton.iconActive = null;

/**
 * @summary Creates the button
 * @protected
 */
PSVNavBarButton.prototype.create = function() {
  PSVComponent.prototype.create.call(this);

  if (this.constructor.icon) {
    this._setIcon(this.constructor.icon);
  }

  if (this.id && this.psv.config.lang[this.id]) {
    this.container.title = this.psv.config.lang[this.id];
  }

  this.container.addEventListener('click', function(e) {
    if (this.enabled) {
      this._onClick();
    }
    e.stopPropagation();
  }.bind(this));
};

/**
 * @summary Destroys the button
 * @protected
 */
PSVNavBarButton.prototype.destroy = function() {
  PSVComponent.prototype.destroy.call(this);
};

/**
 * @summary Changes the active state of the button
 * @param {boolean} [active] - forced state
 */
PSVNavBarButton.prototype.toggleActive = function(active) {
  PSVUtils.toggleClass(this.container, 'psv-button--active', active);

  if (this.constructor.iconActive) {
    this._setIcon(active ? this.constructor.iconActive : this.constructor.icon);
  }
};

/**
 * @summary Disables the button
 */
PSVNavBarButton.prototype.disable = function() {
  this.container.classList.add('psv-button--disabled');

  this.enabled = false;
};

/**
 * @summary Enables the button
 */
PSVNavBarButton.prototype.enable = function() {
  this.container.classList.remove('psv-button--disabled');

  this.enabled = true;
};

/**
 * @summary Set the button icon from {@link PhotoSphereViewer.ICONS}
 * @param {string} icon
 * @param {HTMLElement} [container] - default is the main button container
 * @private
 */
PSVNavBarButton.prototype._setIcon = function(icon, container) {
  if (!container) {
    container = this.container;
  }
  if (icon) {
    container.innerHTML = PhotoSphereViewer.ICONS[icon];
    // classList not supported on IE11, className is read-only !!!!
    container.querySelector('svg').setAttribute('class', 'psv-button-svg');
  }
  else {
    container.innerHTML = '';
  }
};

/**
 * @summary Action when the button is clicked
 * @private
 * @abstract
 */
PSVNavBarButton.prototype._onClick = function() {

};


/**
 * Navigation bar autorotate button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarAutorotateButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  this.create();
}

PSVNavBarAutorotateButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarAutorotateButton.prototype.constructor = PSVNavBarAutorotateButton;

PSVNavBarAutorotateButton.id = 'autorotate';
PSVNavBarAutorotateButton.className = 'psv-button psv-button--hover-scale psv-autorotate-button';
PSVNavBarAutorotateButton.icon = 'play.svg';
PSVNavBarAutorotateButton.iconActive = 'play-active.svg';

/**
 * @override
 */
PSVNavBarAutorotateButton.prototype.create = function() {
  PSVNavBarButton.prototype.create.call(this);

  this.psv.on('autorotate', this);
};

/**
 * @override
 */
PSVNavBarAutorotateButton.prototype.destroy = function() {
  this.psv.off('autorotate', this);

  PSVNavBarButton.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVNavBarAutorotateButton.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'autorotate': this.toggleActive(e.args[0]); break;
    // @formatter:on
  }
};

/**
 * @override
 * @description Toggles autorotate
 */
PSVNavBarAutorotateButton.prototype._onClick = function() {
  this.psv.toggleAutorotate();
};


/**
 * Navigation bar custom button class
 * @param {module:components.PSVNavBar} navbar
 * @param {Object} config
 * @param {string} [config.id]
 * @param {string} [config.className]
 * @param {string} [config.title]
 * @param {string} [config.content]
 * @param {function} [config.onClick]
 * @param {boolean} [config.enabled=true]
 * @param {boolean} [config.visible=true]
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarCustomButton(navbar, config) {
  PSVNavBarButton.call(this, navbar);

  /**
   * @member {Object}
   * @readonly
   * @private
   */
  this.config = config;

  if (this.config.id) {
    this.id = this.config.id;
  }

  this.create();
}

PSVNavBarCustomButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarCustomButton.prototype.constructor = PSVNavBarCustomButton;

PSVNavBarCustomButton.className = 'psv-button psv-custom-button';

/**
 * @override
 */
PSVNavBarCustomButton.prototype.create = function() {
  PSVNavBarButton.prototype.create.call(this);

  if (this.config.className) {
    PSVUtils.addClasses(this.container, this.config.className);
  }

  if (this.config.title) {
    this.container.title = this.config.title;
  }

  if (this.config.content) {
    this.container.innerHTML = this.config.content;
  }

  if (this.config.enabled === false || this.config.disabled === true) {
    this.disable();
  }

  if (this.config.visible === false || this.config.hidden === true) {
    this.hide();
  }
};

/**
 * @override
 */
PSVNavBarCustomButton.prototype.destroy = function() {
  delete this.config;

  PSVNavBarButton.prototype.destroy.call(this);
};

/**
 * @override
 * @description Calls user method
 */
PSVNavBarCustomButton.prototype._onClick = function() {
  if (this.config.onClick) {
    this.config.onClick.apply(this.psv);
  }
};


/**
 * Navigation bar download button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarDownloadButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  this.create();
}

PSVNavBarDownloadButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarDownloadButton.prototype.constructor = PSVNavBarDownloadButton;

PSVNavBarDownloadButton.id = 'download';
PSVNavBarDownloadButton.className = 'psv-button psv-button--hover-scale psv-download-button';
PSVNavBarDownloadButton.icon = 'download.svg';

/**
 * @override
 * @description Asks the browser to download the panorama source file
 */
PSVNavBarDownloadButton.prototype._onClick = function() {
  var link = document.createElement('a');
  link.href = this.psv.config.panorama;
  link.download = this.psv.config.panorama;
  this.psv.container.appendChild(link);
  link.click();
};


/**
 * Navigation bar fullscreen button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarFullscreenButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  this.create();
}

PSVNavBarFullscreenButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarFullscreenButton.prototype.constructor = PSVNavBarFullscreenButton;

PSVNavBarFullscreenButton.id = 'fullscreen';
PSVNavBarFullscreenButton.className = 'psv-button psv-button--hover-scale psv-fullscreen-button';
PSVNavBarFullscreenButton.icon = 'fullscreen-in.svg';
PSVNavBarFullscreenButton.iconActive = 'fullscreen-out.svg';

/**
 * @override
 */
PSVNavBarFullscreenButton.prototype.create = function() {
  PSVNavBarButton.prototype.create.call(this);

  if (!PhotoSphereViewer.SYSTEM.fullscreenEvent) {
    this.hide();
    console.warn('PhotoSphereViewer: fullscreen not supported.');
  }

  this.psv.on('fullscreen-updated', this);
};

/**
 * @override
 */
PSVNavBarFullscreenButton.prototype.destroy = function() {
  this.psv.off('fullscreen-updated', this);

  PSVNavBarButton.prototype.destroy.call(this);
};

/**
 * Handle events
 * @param {Event} e
 * @private
 */
PSVNavBarFullscreenButton.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'fullscreen-updated': this.toggleActive(e.args[0]); break;
    // @formatter:on
  }
};

/**
 * @override
 * @description Toggles fullscreen
 */
PSVNavBarFullscreenButton.prototype._onClick = function() {
  this.psv.toggleFullscreen();
};


/**
 * Navigation bar gyroscope button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarGyroscopeButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  this.create();
}

PSVNavBarGyroscopeButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarGyroscopeButton.prototype.constructor = PSVNavBarGyroscopeButton;

PSVNavBarGyroscopeButton.id = 'gyroscope';
PSVNavBarGyroscopeButton.className = 'psv-button psv-button--hover-scale psv-gyroscope-button';
PSVNavBarGyroscopeButton.icon = 'compass.svg';

/**
 * @override
 * @description The button gets visible once the gyroscope API is ready
 */
PSVNavBarGyroscopeButton.prototype.create = function() {
  PSVNavBarButton.prototype.create.call(this);

  PhotoSphereViewer.SYSTEM.deviceOrientationSupported.then(
    this._onAvailabilityChange.bind(this, true),
    this._onAvailabilityChange.bind(this, false)
  );

  this.hide();

  this.psv.on('gyroscope-updated', this);
};

/**
 * @override
 */
PSVNavBarGyroscopeButton.prototype.destroy = function() {
  this.psv.off('gyroscope-updated', this);

  PSVNavBarButton.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVNavBarGyroscopeButton.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'gyroscope-updated': this.toggleActive(e.args[0]); break;
    // @formatter:on
  }
};

/**
 * @override
 * @description Toggles gyroscope control
 */
PSVNavBarGyroscopeButton.prototype._onClick = function() {
  this.psv.toggleGyroscopeControl();
};

/**
 * @summary Updates button display when API is ready
 * @param {boolean} available
 * @private
 * @throws {PSVError} when {@link THREE.DeviceOrientationControls} is not loaded
 */
PSVNavBarGyroscopeButton.prototype._onAvailabilityChange = function(available) {
  if (available && PSVUtils.checkTHREE('DeviceOrientationControls')) {
    this.show();
  }
};


/**
 * Navigation bar markers button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarMarkersButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  this.create();
}

PSVNavBarMarkersButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarMarkersButton.prototype.constructor = PSVNavBarMarkersButton;

PSVNavBarMarkersButton.id = 'markers';
PSVNavBarMarkersButton.className = 'psv-button psv-button--hover-scale psv-markers-button';
PSVNavBarMarkersButton.icon = 'pin.svg';

/**
 * @override
 * @description Toggles markers list
 */
PSVNavBarMarkersButton.prototype._onClick = function() {
  this.psv.hud.toggleMarkersList();
};


/**
 * Navigation bar gyroscope button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarStereoButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  this.create();
}

PSVNavBarStereoButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarStereoButton.prototype.constructor = PSVNavBarStereoButton;

PSVNavBarStereoButton.id = 'stereo';
PSVNavBarStereoButton.className = 'psv-button psv-button--hover-scale psv-stereo-button';
PSVNavBarStereoButton.icon = 'stereo.svg';

/**
 * @override
 * @description The button gets visible once the gyroscope API is ready
 */
PSVNavBarStereoButton.prototype.create = function() {
  PSVNavBarButton.prototype.create.call(this);

  PhotoSphereViewer.SYSTEM.deviceOrientationSupported.then(
    this._onAvailabilityChange.bind(this, true),
    this._onAvailabilityChange.bind(this, false)
  );

  this.hide();

  this.psv.on('stereo-updated', this);
};

/**
 * @override
 */
PSVNavBarStereoButton.prototype.destroy = function() {
  this.psv.off('stereo-updated', this);

  PSVNavBarButton.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVNavBarStereoButton.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'stereo-updated': this.toggleActive(e.args[0]); break;
    // @formatter:on
  }
};

/**
 * @override
 * @description Toggles gyroscope control
 */
PSVNavBarStereoButton.prototype._onClick = function() {
  this.psv.toggleStereoView();
};

/**
 * @summary Updates button display when API is ready
 * @param {boolean} available
 * @private
 * @throws {PSVError} when {@link THREE.DeviceOrientationControls} is not loaded
 */
PSVNavBarStereoButton.prototype._onAvailabilityChange = function(available) {
  if (available && PSVUtils.checkTHREE('DeviceOrientationControls', 'StereoEffect')) {
    this.show();
  }
};



/**
 * Navigation bar zoom button class
 * @param {module:components.PSVNavBar} navbar
 * @constructor
 * @extends module:components/buttons.PSVNavBarButton
 * @memberof module:components/buttons
 */
function PSVNavBarZoomButton(navbar) {
  PSVNavBarButton.call(this, navbar);

  /**
   * @member {HTMLElement}
   * @readonly
   * @private
   */
  this.zoom_range = null;

  /**
   * @member {HTMLElement}
   * @readonly
   * @private
   */
  this.zoom_value = null;

  /**
   * @member {Object}
   * @private
   */
  this.prop = {
    mousedown: false,
    buttondown: false,
    longPressInterval: null,
    longPressTimeout: null
  };

  this.create();
}

PSVNavBarZoomButton.prototype = Object.create(PSVNavBarButton.prototype);
PSVNavBarZoomButton.prototype.constructor = PSVNavBarZoomButton;

PSVNavBarZoomButton.id = 'zoom';
PSVNavBarZoomButton.className = 'psv-button psv-zoom-button';

/**
 * @override
 */
PSVNavBarZoomButton.prototype.create = function() {
  PSVNavBarButton.prototype.create.call(this);

  var zoom_minus = document.createElement('div');
  zoom_minus.className = 'psv-zoom-button-minus';
  zoom_minus.title = this.psv.config.lang.zoomOut;
  this._setIcon('zoom-out.svg', zoom_minus);
  this.container.appendChild(zoom_minus);

  var zoom_range_bg = document.createElement('div');
  zoom_range_bg.className = 'psv-zoom-button-range';
  this.container.appendChild(zoom_range_bg);

  this.zoom_range = document.createElement('div');
  this.zoom_range.className = 'psv-zoom-button-line';
  zoom_range_bg.appendChild(this.zoom_range);

  this.zoom_value = document.createElement('div');
  this.zoom_value.className = 'psv-zoom-button-handle';
  this.zoom_range.appendChild(this.zoom_value);

  var zoom_plus = document.createElement('div');
  zoom_plus.className = 'psv-zoom-button-plus';
  zoom_plus.title = this.psv.config.lang.zoomIn;
  this._setIcon('zoom-in.svg', zoom_plus);
  this.container.appendChild(zoom_plus);

  this.zoom_range.addEventListener('mousedown', this);
  this.zoom_range.addEventListener('touchstart', this);
  this.psv.container.addEventListener('mousemove', this);
  this.psv.container.addEventListener('touchmove', this);
  this.psv.container.addEventListener('mouseup', this);
  this.psv.container.addEventListener('touchend', this);
  zoom_minus.addEventListener('mousedown', this._zoomOut.bind(this));
  zoom_plus.addEventListener('mousedown', this._zoomIn.bind(this));

  this.psv.on('zoom-updated', this);

  this.psv.once('ready', function() {
    this._moveZoomValue(this.psv.prop.zoom_lvl);
  }.bind(this));
};

/**
 * @override
 */
PSVNavBarZoomButton.prototype.destroy = function() {
  this._stopZoomChange();

  this.psv.container.removeEventListener('mousemove', this);
  this.psv.container.removeEventListener('touchmove', this);
  this.psv.container.removeEventListener('mouseup', this);
  this.psv.container.removeEventListener('touchend', this);

  delete this.zoom_range;
  delete this.zoom_value;

  this.psv.off('zoom-updated', this);

  PSVNavBarButton.prototype.destroy.call(this);
};

/**
 * @summary Handles events
 * @param {Event} e
 * @private
 */
PSVNavBarZoomButton.prototype.handleEvent = function(e) {
  switch (e.type) {
    // @formatter:off
    case 'mousedown':     this._initZoomChangeWithMouse(e); break;
    case 'touchstart':    this._initZoomChangeByTouch(e); break;
    case 'mousemove':     this._changeZoomWithMouse(e); break;
    case 'touchmove':     this._changeZoomByTouch(e); break;
    case 'mouseup':       this._stopZoomChange(e); break;
    case 'touchend':      this._stopZoomChange(e); break;
    case 'zoom-updated':  this._moveZoomValue(e.args[0]); break;
    // @formatter:on
  }
};

/**
 * @summary Moves the zoom cursor
 * @param {int} level
 * @private
 */
PSVNavBarZoomButton.prototype._moveZoomValue = function(level) {
  this.zoom_value.style.left = (level / 100 * this.zoom_range.offsetWidth - this.zoom_value.offsetWidth / 2) + 'px';
};

/**
 * @summary Handles mouse down events
 * @param {MouseEvent} evt
 * @private
 */
PSVNavBarZoomButton.prototype._initZoomChangeWithMouse = function(evt) {
  if (!this.enabled) {
    return;
  }

  this.prop.mousedown = true;
  this._changeZoom(evt.clientX);
};

/**
 * @summary Handles touch events
 * @param {TouchEvent} evt
 * @private
 */
PSVNavBarZoomButton.prototype._initZoomChangeByTouch = function(evt) {
  if (!this.enabled) {
    return;
  }

  this.prop.mousedown = true;
  this._changeZoom(evt.changedTouches[0].clientX);
};

/**
 * @summary Handles click events
 * @description Zooms in and register long press timer
 * @private
 */
PSVNavBarZoomButton.prototype._zoomIn = function() {
  if (!this.enabled) {
    return;
  }

  this.prop.buttondown = true;
  this.psv.zoomIn();
  this.prop.longPressTimeout = window.setTimeout(this._startLongPressInterval.bind(this, 1), 200);
};

/**
 * @summary Handles click events
 * @description Zooms out and register long press timer
 * @private
 */
PSVNavBarZoomButton.prototype._zoomOut = function() {
  if (!this.enabled) {
    return;
  }

  this.prop.buttondown = true;
  this.psv.zoomOut();
  this.prop.longPressTimeout = window.setTimeout(this._startLongPressInterval.bind(this, -1), 200);
};

/**
 * @summary Continues zooming as long as the user presses the button
 * @param value
 * @private
 */
PSVNavBarZoomButton.prototype._startLongPressInterval = function(value) {
  if (this.prop.buttondown) {
    this.prop.longPressInterval = window.setInterval(function() {
      this.psv.zoom(this.psv.prop.zoom_lvl + value);
    }.bind(this), 50);
  }
};

/**
 * @summary Handles mouse up events
 * @private
 */
PSVNavBarZoomButton.prototype._stopZoomChange = function() {
  if (!this.enabled) {
    return;
  }

  window.clearInterval(this.prop.longPressInterval);
  window.clearTimeout(this.prop.longPressTimeout);
  this.prop.longPressInterval = null;
  this.prop.mousedown = false;
  this.prop.buttondown = false;
};

/**
 * @summary Handles mouse move events
 * @param {MouseEvent} evt
 * @private
 */
PSVNavBarZoomButton.prototype._changeZoomWithMouse = function(evt) {
  if (!this.enabled) {
    return;
  }

  evt.preventDefault();
  this._changeZoom(evt.clientX);
};

/**
 * @summary Handles touch move events
 * @param {TouchEvent} evt
 * @private
 */
PSVNavBarZoomButton.prototype._changeZoomByTouch = function(evt) {
  if (!this.enabled) {
    return;
  }
  this._changeZoom(evt.changedTouches[0].clientX);
};

/**
 * @summary Zoom change
 * @param {int} x - mouse/touch position
 * @private
 */
PSVNavBarZoomButton.prototype._changeZoom = function(x) {
  if (this.prop.mousedown) {
    var user_input = parseInt(x) - this.zoom_range.getBoundingClientRect().left;
    var zoom_level = user_input / this.zoom_range.offsetWidth * 100;
    this.psv.zoom(zoom_level);
  }
};


/**
 * Custom error used in the lib
 * @param {string} message
 * @constructor
 */
function PSVError(message) {
  this.message = message;

  // Use V8's native method if available, otherwise fallback
  if ('captureStackTrace' in Error) {
    Error.captureStackTrace(this, PSVError);
  }
  else {
    this.stack = (new Error()).stack;
  }
}

PSVError.prototype = Object.create(Error.prototype);
PSVError.prototype.name = 'PSVError';
PSVError.prototype.constructor = PSVError;

/**
 * @summary exposes {@link PSVError}
 * @memberof PhotoSphereViewer
 * @readonly
 */
PhotoSphereViewer.Error = PSVError;


/**
 * Object representing a marker
 * @param {Object} properties - see {@link http://photo-sphere-viewer.js.org/markers.html#config} (merged with the object itself)
 * @param {PhotoSphereViewer} psv
 * @constructor
 * @throws {PSVError} when the configuration is incorrect
 */
function PSVMarker(properties, psv) {
  if (!properties.id) {
    throw new PSVError('missing marker id');
  }

  if (properties.image && (!properties.width || !properties.height)) {
    throw new PSVError('missing marker width/height');
  }

  if (properties.image || properties.html) {
    if ((!properties.hasOwnProperty('x') || !properties.hasOwnProperty('y')) && (!properties.hasOwnProperty('latitude') || !properties.hasOwnProperty('longitude'))) {
      throw new PSVError('missing marker position, latitude/longitude or x/y');
    }
  }

  /**
   * @member {PhotoSphereViewer}
   * @readonly
   * @protected
   */
  this.psv = psv;

  /**
   * @member {boolean}
   */
  this.visible = true;

  /**
   * @member {boolean}
   * @readonly
   * @private
   */
  this._dynamicSize = false;

  // private properties
  var _id = properties.id;
  var _type = PSVMarker.getType(properties, false);
  var $el;

  // readonly properties
  Object.defineProperties(this, {
    /**
     * @memberof PSVMarker
     * @type {string}
     * @readonly
     */
    id: {
      configurable: false,
      enumerable: true,
      get: function() {
        return _id;
      },
      set: function() {
      }
    },
    /**
     * @memberof PSVMarker
     * @type {string}
     * @see PSVMarker.types
     * @readonly
     */
    type: {
      configurable: false,
      enumerable: true,
      get: function() {
        return _type;
      },
      set: function() {
      }
    },
    /**
     * @memberof PSVMarker
     * @type {HTMLDivElement|SVGElement}
     * @readonly
     */
    $el: {
      configurable: false,
      enumerable: true,
      get: function() {
        return $el;
      },
      set: function() {
      }
    },
    /**
     * @summary Quick access to self value of key `type`
     * @memberof PSVMarker
     * @type {*}
     * @private
     */
    _def: {
      configurable: false,
      enumerable: true,
      get: function() {
        return this[_type];
      },
      set: function(value) {
        this[_type] = value;
      }
    }
  });

  // create element
  if (this.isNormal()) {
    $el = document.createElement('div');
  }
  else if (this.isPolygon()) {
    $el = document.createElementNS(PSVUtils.svgNS, 'polygon');
  }
  else if (this.isPolyline()) {
    $el = document.createElementNS(PSVUtils.svgNS, 'polyline');
  }
  else {
    $el = document.createElementNS(PSVUtils.svgNS, this.type);
  }

  $el.id = 'psv-marker-' + this.id;
  $el.psvMarker = this;

  this.update(properties);
}

/**
 * @summary Types of markers
 * @type {string[]}
 * @readonly
 */
PSVMarker.types = ['image', 'html', 'polygon_px', 'polygon_rad', 'polyline_px', 'polyline_rad', 'rect', 'circle', 'ellipse', 'path'];

/**
 * @summary Determines the type of a marker by the available properties
 * @param {object} properties
 * @param {boolean} [allowNone=false]
 * @returns {string}
 * @throws {PSVError} when the marker's type cannot be found
 */
PSVMarker.getType = function(properties, allowNone) {
  var found = [];

  PSVMarker.types.forEach(function(type) {
    if (properties[type]) {
      found.push(type);
    }
  });

  if (found.length === 0 && !allowNone) {
    throw new PSVError('missing marker content, either ' + PSVMarker.types.join(', '));
  }
  else if (found.length > 1) {
    throw new PSVError('multiple marker content, either ' + PSVMarker.types.join(', '));
  }

  return found[0];
};

/**
 * @summary Destroys the marker
 */
PSVMarker.prototype.destroy = function() {
  delete this.$el.psvMarker;
};

/**
 * @summary Checks if it is a normal marker (image or html)
 * @returns {boolean}
 */
PSVMarker.prototype.isNormal = function() {
  return this.type === 'image' || this.type === 'html';
};

/**
 * @summary Checks if it is a polygon/polyline marker
 * @returns {boolean}
 */
PSVMarker.prototype.isPoly = function() {
  return this.isPolygon() || this.isPolyline();
};

/**
 * @summary Checks if it is a polygon marker
 * @returns {boolean}
 */
PSVMarker.prototype.isPolygon = function() {
  return this.type === 'polygon_px' || this.type === 'polygon_rad';
};

/**
 * @summary Checks if it is a polyline marker
 * @returns {boolean}
 */
PSVMarker.prototype.isPolyline = function() {
  return this.type === 'polyline_px' || this.type === 'polyline_rad';
};

/**
 * @summary Checks if it is an SVG marker
 * @returns {boolean}
 */
PSVMarker.prototype.isSvg = function() {
  return this.type === 'rect' || this.type === 'circle' || this.type === 'ellipse' || this.type === 'path';
};

/**
 * @summary Computes marker scale from zoom level
 * @param {float} zoomLevel
 * @returns {float}
 */
PSVMarker.prototype.getScale = function(zoomLevel) {
  if (Array.isArray(this.scale)) {
    return this.scale[0] + (this.scale[1] - this.scale[0]) * PSVUtils.animation.easings.inQuad(zoomLevel / 100);
  }
  else if (typeof this.scale === 'function') {
    return this.scale(zoomLevel);
  }
  else if (typeof this.scale === 'number') {
    return this.scale * PSVUtils.animation.easings.inQuad(zoomLevel / 100);
  }
  else {
    return 1;
  }
};

/**
 * @summary Updates the marker with new properties
 * @param {object} [properties]
 * @throws {PSVError} when trying to change the marker's type
 */
PSVMarker.prototype.update = function(properties) {
  // merge objects
  if (properties && properties !== this) {
    var newType = PSVMarker.getType(properties, true);

    if (newType !== undefined && newType !== this.type) {
      throw new PSVError('cannot change marker type');
    }

    PSVUtils.deepmerge(this, properties);
  }

  // reset CSS class
  if (this.isNormal()) {
    this.$el.setAttribute('class', 'psv-marker psv-marker--normal');
  }
  else {
    this.$el.setAttribute('class', 'psv-marker psv-marker--svg');
  }

  // add CSS classes
  if (this.className) {
    PSVUtils.addClasses(this.$el, this.className);
  }
  if (this.tooltip) {
    PSVUtils.addClasses(this.$el, 'has-tooltip');
    if (typeof this.tooltip === 'string') {
      this.tooltip = { content: this.tooltip };
    }
  }

  // apply style
  if (this.style) {
    PSVUtils.deepmerge(this.$el.style, this.style);
  }

  // parse anchor
  this.anchor = PSVUtils.parsePosition(this.anchor);

  if (this.isNormal()) {
    this._updateNormal();
  }
  else if (this.isPolygon()) {
    this._updatePoly('polygon_rad', 'polygon_px');
  }
  else if (this.isPolyline()) {
    this._updatePoly('polyline_rad', 'polyline_px');
  }
  else {
    this._updateSvg();
  }
};

/**
 * @summary Updates a normal marker
 * @private
 */
PSVMarker.prototype._updateNormal = function() {
  if (this.width && this.height) {
    this.$el.style.width = this.width + 'px';
    this.$el.style.height = this.height + 'px';
    this._dynamicSize = false;
  }
  else {
    this._dynamicSize = true;
  }

  if (this.image) {
    this.$el.style.backgroundImage = 'url(' + this.image + ')';
  }
  else {
    this.$el.innerHTML = this.html;
  }

  // set anchor
  this.$el.style.transformOrigin = this.anchor.left * 100 + '% ' + this.anchor.top * 100 + '%';

  // convert texture coordinates to spherical coordinates
  this.psv.cleanPosition(this);

  // compute x/y/z position
  this.position3D = this.psv.sphericalCoordsToVector3(this);
};

/**
 * @summary Updates an SVG marker
 * @private
 */
PSVMarker.prototype._updateSvg = function() {
  this._dynamicSize = true;

  // set content
  switch (this.type) {
    case 'rect':
      if (typeof this._def === 'number') {
        this._def = {
          x: 0,
          y: 0,
          width: this._def,
          height: this._def
        };
      }
      else if (Array.isArray(this._def)) {
        this._def = {
          x: 0,
          y: 0,
          width: this._def[0],
          height: this._def[1]
        };
      }
      else {
        this._def.x = this._def.y = 0;
      }
      break;

    case 'circle':
      if (typeof this._def === 'number') {
        this._def = {
          cx: this._def,
          cy: this._def,
          r: this._def
        };
      }
      else if (Array.isArray(this._def)) {
        this._def = {
          cx: this._def[0],
          cy: this._def[0],
          r: this._def[0]
        };
      }
      else {
        this._def.cx = this._def.cy = this._def.r;
      }
      break;

    case 'ellipse':
      if (typeof this._def === 'number') {
        this._def = {
          cx: this._def,
          cy: this._def,
          rx: this._def,
          ry: this._def
        };
      }
      else if (Array.isArray(this._def)) {
        this._def = {
          cx: this._def[0],
          cy: this._def[1],
          rx: this._def[0],
          ry: this._def[1]
        };
      }
      else {
        this._def.cx = this._def.rx;
        this._def.cy = this._def.ry;
      }
      break;

    case 'path':
      if (typeof this._def === 'string') {
        this._def = {
          d: this._def
        };
      }
      break;
  }

  Object.getOwnPropertyNames(this._def).forEach(function(prop) {
    this.$el.setAttributeNS(null, prop, this._def[prop]);
  }, this);

  // set style
  if (this.svgStyle) {
    Object.getOwnPropertyNames(this.svgStyle).forEach(function(prop) {
      this.$el.setAttributeNS(null, PSVUtils.dasherize(prop), this.svgStyle[prop]);
    }, this);
  }
  else {
    this.$el.setAttributeNS(null, 'fill', 'rgba(0,0,0,0.5)');
  }

  // convert texture coordinates to spherical coordinates
  this.psv.cleanPosition(this);

  // compute x/y/z position
  this.position3D = this.psv.sphericalCoordsToVector3(this);
};

/**
 * @summary Updates a polygon marker
 * @param {'polygon_rad'|'polyline_rad'} key_rad
 * @param {'polygon_px'|'polyline_px'} key_px
 * @private
 */
PSVMarker.prototype._updatePoly = function(key_rad, key_px) {
  this._dynamicSize = true;

  // set style
  if (this.svgStyle) {
    Object.getOwnPropertyNames(this.svgStyle).forEach(function(prop) {
      this.$el.setAttributeNS(null, PSVUtils.dasherize(prop), this.svgStyle[prop]);
    }, this);

    if (this.isPolyline() && !this.svgStyle.fill) {
      this.$el.setAttributeNS(null, 'fill', 'none');
    }
  }
  else if (this.isPolygon()) {
    this.$el.setAttributeNS(null, 'fill', 'rgba(0,0,0,0.5)');
  }
  else if (this.isPolyline()) {
    this.$el.setAttributeNS(null, 'fill', 'none');
    this.$el.setAttributeNS(null, 'stroke', 'rgb(0,0,0)');
  }

  // fold arrays: [1,2,3,4] => [[1,2],[3,4]]
  [this[key_rad], this[key_px]].forEach(function(polygon) {
    if (polygon && typeof polygon[0] !== 'object') {
      for (var i = 0; i < polygon.length; i++) {
        polygon.splice(i, 2, [polygon[i], polygon[i + 1]]);
      }
    }
  });

  // convert texture coordinates to spherical coordinates
  if (this[key_px]) {
    this[key_rad] = this[key_px].map(function(coord) {
      var sphericalCoords = this.psv.textureCoordsToSphericalCoords({ x: coord[0], y: coord[1] });
      return [sphericalCoords.longitude, sphericalCoords.latitude];
    }, this);
  }
  // clean angles
  else {
    this[key_rad] = this[key_rad].map(function(coord) {
      return [
        PSVUtils.parseAngle(coord[0]),
        PSVUtils.parseAngle(coord[1], true)
      ];
    });
  }

  // TODO : compute the center of the polygon
  this.longitude = this[key_rad][0][0];
  this.latitude = this[key_rad][0][1];

  // compute x/y/z positions
  this.positions3D = this[key_rad].map(function(coord) {
    return this.psv.sphericalCoordsToVector3({ longitude: coord[0], latitude: coord[1] });
  }, this);
};


/**
 * Static utilities for PSV
 * @namespace
 */
var PSVUtils = {};

/**
 * @summary exposes {@link PSVUtils}
 * @member {object}
 * @memberof PhotoSphereViewer
 * @readonly
 */
PhotoSphereViewer.Utils = PSVUtils;

/**
 * @summary Short-Hand for PI*2
 * @type {float}
 * @readonly
 */
PSVUtils.TwoPI = Math.PI * 2.0;

/**
 * @summary Short-Hand for PI/2
 * @type {float}
 * @readonly
 */
PSVUtils.HalfPI = Math.PI / 2.0;

/**
 * @summary Namespace for SVG creation
 * @type {string}
 * @readonly
 */
PSVUtils.svgNS = 'http://www.w3.org/2000/svg';

/**
 * @summary Checks if some three.js components are loaded
 * @param {...string} components
 * @returns {boolean}
 */
PSVUtils.checkTHREE = function(components) {
  for (var i = 0, l = arguments.length; i < l; i++) {
    if (!(arguments[i] in THREE)) {
      return false;
    }
  }

  return true;
};

/**
 * @summary Detects if canvas is supported
 * @returns {boolean}
 */
PSVUtils.isCanvasSupported = function() {
  var canvas = document.createElement('canvas');
  return !!(canvas.getContext && canvas.getContext('2d'));
};

/**
 * @summary Tries to return a canvas webgl context
 * @returns {WebGLRenderingContext}
 */
PSVUtils.getWebGLCtx = function() {
  var canvas = document.createElement('canvas');
  var names = ['webgl', 'experimental-webgl', 'moz-webgl', 'webkit-3d'];
  var context = null;

  if (!canvas.getContext) {
    return null;
  }

  if (names.some(function(name) {
      try {
        context = canvas.getContext(name);
        return (context && typeof context.getParameter === 'function');
      } catch (e) {
        return false;
      }
    })) {
    return context;
  }
  else {
    return null;
  }
};

/**
 * @summary Detects if WebGL is supported
 * @returns {boolean}
 */
PSVUtils.isWebGLSupported = function() {
  return !!window.WebGLRenderingContext && PSVUtils.getWebGLCtx() !== null;
};

/**
 * @summary Detects if device orientation is supported
 * @description We can only be sure device orientation is supported once received an event with coherent data
 * @returns {Promise}
 */
PSVUtils.isDeviceOrientationSupported = function() {
  var defer = D();

  if ('DeviceOrientationEvent' in window) {
    var listener = function(event) {
      if (event && event.alpha !== null && !isNaN(event.alpha)) {
        defer.resolve();
      }
      else {
        defer.reject();
      }

      window.removeEventListener('deviceorientation', listener);
    };

    window.addEventListener('deviceorientation', listener, false);

    setTimeout(function() {
      if (defer.promise.isPending()) {
        listener(null);
      }
    }, 2000);
  }
  else {
    defer.reject();
  }

  return defer.promise;
};

/**
 * @summary Detects if the user is using a touch screen
 * @returns {Promise}
 */
PSVUtils.isTouchEnabled = function() {
  var defer = D();

  var listener = function(e) {
    if (e) {
      defer.resolve();
    }
    else {
      defer.reject();
    }

    window.removeEventListener('touchstart', listener);
  };

  window.addEventListener('touchstart', listener, false);

  setTimeout(function() {
    if (defer.promise.isPending()) {
      listener(null);
    }
  }, 10000); // this is totally arbitrary

  return defer.promise;
};

/**
 * @summary Gets max texture width in WebGL context
 * @returns {int}
 */
PSVUtils.getMaxTextureWidth = function() {
  var ctx = PSVUtils.getWebGLCtx();
  if (ctx !== null) {
    return ctx.getParameter(ctx.MAX_TEXTURE_SIZE);
  }
  else {
    return 0;
  }
};

/**
 * @summary Toggles a CSS class
 * @param {HTMLElement|SVGElement} element
 * @param {string} className
 * @param {boolean} [active] - forced state
 */
PSVUtils.toggleClass = function(element, className, active) {
  // manual implementation for IE11 and SVGElement
  if (!element.classList) {
    var currentClassName = element.getAttribute('class') || '';
    var currentActive = currentClassName.indexOf(className) !== -1;
    var regex = new RegExp('(?:^|\\s)' + className + '(?:\\s|$)');

    if ((active === undefined || active) && !currentActive) {
      currentClassName += currentClassName.length > 0 ? ' ' + className : className;
    }
    else if (!active) {
      currentClassName = currentClassName.replace(regex, ' ');
    }

    element.setAttribute('class', currentClassName);
  }
  else {
    if (active === undefined) {
      element.classList.toggle(className);
    }
    else if (active && !element.classList.contains(className)) {
      element.classList.add(className);
    }
    else if (!active) {
      element.classList.remove(className);
    }
  }
};

/**
 * @summary Adds one or several CSS classes to an element
 * @param {HTMLElement} element
 * @param {string} className
 */
PSVUtils.addClasses = function(element, className) {
  if (!className) {
    return;
  }
  className.split(' ').forEach(function(name) {
    PSVUtils.toggleClass(element, name, true);
  });
};

/**
 * @summary Removes one or several CSS classes to an element
 * @param {HTMLElement} element
 * @param {string} className
 */
PSVUtils.removeClasses = function(element, className) {
  if (!className) {
    return;
  }
  className.split(' ').forEach(function(name) {
    PSVUtils.toggleClass(element, name, false);
  });
};

/**
 * @summary Searches if an element has a particular parent at any level including itself
 * @param {HTMLElement} el
 * @param {HTMLElement} parent
 * @returns {boolean}
 */
PSVUtils.hasParent = function(el, parent) {
  do {
    if (el === parent) {
      return true;
    }
  } while (!!(el = el.parentNode));

  return false;
};

/**
 * @summary Gets the closest parent (can by itself)
 * @param {HTMLElement} el (HTMLElement)
 * @param {string} selector
 * @returns {HTMLElement}
 */
PSVUtils.getClosest = function(el, selector) {
  var matches = el.matches || el.msMatchesSelector;

  do {
    if (matches.bind(el)(selector)) {
      return el;
    }
  } while (!!(el = el.parentElement));

  return null;
};

/**
 * @summary Gets the event name for mouse wheel
 * @returns {string}
 */
PSVUtils.mouseWheelEvent = function() {
  return 'onwheel' in document.createElement('div') ? 'wheel' : // Modern browsers support "wheel"
    document.onmousewheel !== undefined ? 'mousewheel' : // Webkit and IE support at least "mousewheel"
      'DOMMouseScroll'; // let's assume that remaining browsers are older Firefox
};

/**
 * @summary  Gets the event name for fullscreen
 * @returns {string}
 */
PSVUtils.fullscreenEvent = function() {
  var map = {
    'exitFullscreen': 'fullscreenchange',
    'webkitExitFullscreen': 'webkitfullscreenchange',
    'mozCancelFullScreen': 'mozfullscreenchange',
    'msExitFullscreen': 'MSFullscreenChange'
  };

  for (var exit in map) {
    if (map.hasOwnProperty(exit) && exit in document) {
      return map[exit];
    }
  }

  return null;
};

/**
 * @summary Ensures that a number is in a given interval
 * @param {number} x
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
PSVUtils.bound = function(x, min, max) {
  return Math.max(min, Math.min(max, x));
};

/**
 * @summary Checks if a value is an integer
 * @function
 * @param {*} value
 * @returns {boolean}
 */
PSVUtils.isInteger = Number.isInteger || function(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  };

/**
 * @summary Computes the sum of an array
 * @param {number[]} array
 * @returns {number}
 */
PSVUtils.sum = function(array) {
  return array.reduce(function(a, b) {
    return a + b;
  }, 0);
};

/**
 * @summary Transforms a string to dash-case
 * {@link https://github.com/shahata/dasherize}
 * @param {string} str
 * @returns {string}
 */
PSVUtils.dasherize = function(str) {
  return str.replace(/[A-Z](?:(?=[^A-Z])|[A-Z]*(?=[A-Z][^A-Z]|$))/g, function(s, i) {
    return (i > 0 ? '-' : '') + s.toLowerCase();
  });
};

/**
 * @summary Returns the value of a given attribute in the panorama metadata
 * @param {string} data
 * @param {string} attr
 * @returns (string)
 */
PSVUtils.getXMPValue = function(data, attr) {
  var result;
  // XMP data are stored in children
  if ((result = data.match('<GPano:' + attr + '>(.*)</GPano:' + attr + '>')) !== null) {
    return result[1];
  }
  // XMP data are stored in attributes
  else if ((result = data.match('GPano:' + attr + '="(.*?)"')) !== null) {
    return result[1];
  }
  else {
    return null;
  }
};

/**
 * @summary Detects if fullscreen is enabled
 * @param {HTMLElement} elt
 * @returns {boolean}
 */
PSVUtils.isFullscreenEnabled = function(elt) {
  return (document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement) === elt;
};

/**
 * @summary Enters fullscreen mode
 * @param {HTMLElement} elt
 */
PSVUtils.requestFullscreen = function(elt) {
  (elt.requestFullscreen || elt.mozRequestFullScreen || elt.webkitRequestFullscreen || elt.msRequestFullscreen).call(elt);
};

/**
 * @summary Exits fullscreen mode
 */
PSVUtils.exitFullscreen = function() {
  (document.exitFullscreen || document.mozCancelFullScreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
};

/**
 * @summary Gets an element style
 * @param {HTMLElement} elt
 * @param {string} prop
 * @returns {*}
 */
PSVUtils.getStyle = function(elt, prop) {
  return window.getComputedStyle(elt, null)[prop];
};

/**
 * @summary Compute the shortest offset between two longitudes
 * @param {float} from
 * @param {float} to
 * @returns {float}
 */
PSVUtils.getShortestArc = function(from, to) {
  var tCandidates = [
    0, // direct
    PSVUtils.TwoPI, // clock-wise cross zero
    -PSVUtils.TwoPI // counter-clock-wise cross zero
  ];

  return tCandidates.reduce(function(value, candidate) {
    candidate = to - from + candidate;
    return Math.abs(candidate) < Math.abs(value) ? candidate : value;
  }, Infinity);
};

/**
 * @summary Translate CSS values like "top center" or "10% 50%" as top and left positions
 * @description The implementation is as close as possible to the "background-position" specification
 * {@link https://developer.mozilla.org/en-US/docs/Web/CSS/background-position}
 * @param {string} value
 * @returns {{top: float, left: float}}
 */
PSVUtils.parsePosition = function(value) {
  if (!value) {
    return { top: 0.5, left: 0.5 };
  }

  if (typeof value === 'object') {
    return value;
  }

  var tokens = value.toLocaleLowerCase().split(' ').slice(0, 2);

  if (tokens.length === 1) {
    if (PSVUtils.parsePosition.positions[tokens[0]] !== undefined) {
      tokens = [tokens[0], 'center'];
    }
    else {
      tokens = [tokens[0], tokens[0]];
    }
  }

  var xFirst = tokens[1] !== 'left' && tokens[1] !== 'right' && tokens[0] !== 'top' && tokens[0] !== 'bottom';

  tokens = tokens.map(function(token) {
    return PSVUtils.parsePosition.positions[token] || token;
  });

  if (!xFirst) {
    tokens.reverse();
  }

  var parsed = tokens.join(' ').match(/^([0-9.]+)% ([0-9.]+)%$/);

  if (parsed) {
    return {
      left: parsed[1] / 100,
      top: parsed[2] / 100
    };
  }
  else {
    return { top: 0.5, left: 0.5 };
  }
};

PSVUtils.parsePosition.positions = { 'top': '0%', 'bottom': '100%', 'left': '0%', 'right': '100%', 'center': '50%' };

/**
 * @summary Parses an speed
 * @param {string} speed - The speed, in radians/degrees/revolutions per second/minute
 * @returns {float} radians per second
 * @throws {PSVError} when the speed cannot be parsed
 */
PSVUtils.parseSpeed = function(speed) {
  if (typeof speed === 'string') {
    speed = speed.toString().trim();

    // Speed extraction
    var speed_value = parseFloat(speed.replace(/^(-?[0-9]+(?:\.[0-9]*)?).*$/, '$1'));
    var speed_unit = speed.replace(/^-?[0-9]+(?:\.[0-9]*)?(.*)$/, '$1').trim();

    // "per minute" -> "per second"
    if (speed_unit.match(/(pm|per minute)$/)) {
      speed_value /= 60;
    }

    // Which unit?
    switch (speed_unit) {
      // Degrees per minute / second
      case 'dpm':
      case 'degrees per minute':
      case 'dps':
      case 'degrees per second':
        speed = THREE.Math.degToRad(speed_value);
        break;

      // Radians per minute / second
      case 'radians per minute':
      case 'radians per second':
        speed = speed_value;
        break;

      // Revolutions per minute / second
      case 'rpm':
      case 'revolutions per minute':
      case 'rps':
      case 'revolutions per second':
        speed = speed_value * PSVUtils.TwoPI;
        break;

      // Unknown unit
      default:
        throw new PSVError('unknown speed unit "' + speed_unit + '"');
    }
  }

  return speed;
};

/**
 * @summary Parses an angle value in radians or degrees and returns a normalized value in radians
 * @param {string|number} angle - eg: 3.14, 3.14rad, 180deg
 * @param {boolean} [zeroCenter=false] - normalize between -Pi/2 - Pi/2 instead of 0 - 2*Pi
 * @returns {float}
 * @throws {PSVError} when the angle cannot be parsed
 */
PSVUtils.parseAngle = function(angle, zeroCenter) {
  if (typeof angle === 'string') {
    var match = angle.toLowerCase().trim().match(/^(-?[0-9]+(?:\.[0-9]*)?)(.*)$/);

    if (!match) {
      throw new PSVError('unknown angle "' + angle + '"');
    }

    var value = parseFloat(match[1]);
    var unit = match[2];

    if (unit) {
      switch (unit) {
        case 'deg':
        case 'degs':
          angle = THREE.Math.degToRad(value);
          break;
        case 'rad':
        case 'rads':
          angle = value;
          break;
        default:
          throw new PSVError('unknown angle unit "' + unit + '"');
      }
    }
    else {
      angle = value;
    }
  }

  angle = (zeroCenter ? angle + Math.PI : angle) % PSVUtils.TwoPI;

  if (angle < 0) {
    angle = PSVUtils.TwoPI + angle;
  }

  return zeroCenter ? PSVUtils.bound(angle - Math.PI, -PSVUtils.HalfPI, PSVUtils.HalfPI) : angle;
};

/**
 * @summary Removes all children of a three.js scene and dispose all textures
 * @param {THREE.Scene} scene
 */
PSVUtils.cleanTHREEScene = function(scene) {
  scene.children.forEach(function(item) {
    if (item instanceof THREE.Mesh) {
      if (item.geometry) {
        item.geometry.dispose();
        item.geometry = null;
      }

      if (item.material) {
        if (item.material.materials) {
          item.material.materials.forEach(function(material) {
            if (material.map) {
              material.map.dispose();
              material.map = null;
            }

            material.dispose();
          });

          item.material.materials.length = 0;
        }
        else {
          if (item.material.map) {
            item.material.map.dispose();
            item.material.map = null;
          }

          item.material.dispose();
        }

        item.material = null;
      }
    }
  });
  scene.children.length = 0;
};

/**
 * @callback AnimationOnTick
 * @memberOf PSVUtils
 * @param {Object} properties - current values
 * @param {float} progress - 0 to 1
 */

/**
 * @summary Interpolates each property with an easing and optional delay
 * @param {Object} options
 * @param {Object[]} options.properties
 * @param {number} options.properties[].start
 * @param {number} options.properties[].end
 * @param {int} options.duration
 * @param {int} [options.delay=0]
 * @param {string} [options.easing='linear']
 * @param {AnimationOnTick} options.onTick - called on each frame
 * @returns {Promise} Promise with an additional "cancel" method
 */
PSVUtils.animation = function(options) {
  var defer = D(false); // alwaysAsync = false to allow immediate resolution of "cancel"
  var start = null;

  if (!options.easing || typeof options.easing === 'string') {
    options.easing = PSVUtils.animation.easings[options.easing || 'linear'];
  }

  function run(timestamp) {
    // the animation has been cancelled
    if (defer.promise.getStatus() === -1) {
      return;
    }

    // first iteration
    if (start === null) {
      start = timestamp;
    }

    // compute progress
    var progress = (timestamp - start) / options.duration;
    var current = {};
    var name;

    if (progress < 1.0) {
      // interpolate properties
      for (name in options.properties) {
        current[name] = options.properties[name].start + (options.properties[name].end - options.properties[name].start) * options.easing(progress);
      }

      options.onTick(current, progress);

      window.requestAnimationFrame(run);
    }
    else {
      // call onTick one last time with final values
      for (name in options.properties) {
        current[name] = options.properties[name].end;
      }

      options.onTick(current, 1.0);

      window.requestAnimationFrame(function() {
        defer.resolve();
      });
    }
  }

  if (options.delay !== undefined) {
    window.setTimeout(function() {
      window.requestAnimationFrame(run);
    }, options.delay);
  }
  else {
    window.requestAnimationFrame(run);
  }

  // add a "cancel" to the promise
  var promise = defer.promise;
  promise.cancel = function() {
    defer.reject();
  };
  return promise;
};

/**
 * @summary Collection of easing functions
 * {@link https://gist.github.com/frederickk/6165768}
 * @type {Object.<string, Function>}
 */
// @formatter:off
// jscs:disable
/* jshint ignore:start */
PSVUtils.animation.easings = {
  linear: function(t) { return t; },

  inQuad: function(t) { return t*t; },
  outQuad: function(t) { return t*(2-t); },
  inOutQuad: function(t) { return t<.5 ? 2*t*t : -1+(4-2*t)*t; },

  inCubic: function(t) { return t*t*t; },
  outCubic: function(t) { return (--t)*t*t+1; },
  inOutCubic: function(t) { return t<.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1; },

  inQuart: function(t) { return t*t*t*t; },
  outQuart: function(t) { return 1-(--t)*t*t*t; },
  inOutQuart: function(t) { return t<.5 ? 8*t*t*t*t : 1-8*(--t)*t*t*t; },

  inQuint: function(t) { return t*t*t*t*t; },
  outQuint: function(t) { return 1+(--t)*t*t*t*t; },
  inOutQuint: function(t) { return t<.5 ? 16*t*t*t*t*t : 1+16*(--t)*t*t*t*t; },

  inSine: function(t) { return 1-Math.cos(t*(Math.PI/2)); },
  outSine: function(t) { return Math.sin(t*(Math.PI/2)); },
  inOutSine: function(t) { return .5-.5*Math.cos(Math.PI*t); },

  inExpo: function(t) { return Math.pow(2, 10*(t-1)); },
  outExpo: function(t) { return 1-Math.pow(2, -10*t); },
  inOutExpo: function(t) { t=t*2-1; return t<0 ? .5*Math.pow(2, 10*t) : 1-.5*Math.pow(2, -10*t); },

  inCirc: function(t) { return 1-Math.sqrt(1-t*t); },
  outCirc: function(t) { t--; return Math.sqrt(1-t*t); },
  inOutCirc: function(t) { t*=2; return t<1 ? .5-.5*Math.sqrt(1-t*t) : .5+.5*Math.sqrt(1-(t-=2)*t); }
};
/* jshint ignore:end */
// jscs:enable
// @formatter:off

/**
 * @summary Returns a function, that, when invoked, will only be triggered at most once during a given window of time.
 * @copyright underscore.js - modified by Clément Prévost {@link http://stackoverflow.com/a/27078401}
 * @param {Function} func
 * @param {int} wait
 * @returns {Function}
 */
PSVUtils.throttle = function(func, wait) {
  var self, args, result;
  var timeout = null;
  var previous = 0;
  var later = function() {
    previous = Date.now();
    timeout = null;
    result = func.apply(self, args);
    if (!timeout) {
      self = args = null;
    }
  };
  return function() {
    var now = Date.now();
    if (!previous) {
      previous = now;
    }
    var remaining = wait - (now - previous);
    self = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(self, args);
      if (!timeout) {
        self = args = null;
      }
    }
    else if (!timeout) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };
};

/**
 * @summary Test if an object is a plain object
 * @description Test if an object is a plain object, i.e. is constructed
 * by the built-in Object constructor and inherits directly from Object.prototype
 * or null. Some built-in objects pass the test, e.g. Math which is a plain object
 * and some host or exotic objects may pass also.
 * {@link http://stackoverflow.com/a/5878101/1207670}
 * @param {*} obj
 * @returns {boolean}
 */
PSVUtils.isPlainObject = function(obj) {
  // Basic check for Type object that's not null
  if (typeof obj === 'object' && obj !== null) {
    // If Object.getPrototypeOf supported, use it
    if (typeof Object.getPrototypeOf === 'function') {
      var proto = Object.getPrototypeOf(obj);
      return proto === Object.prototype || proto === null;
    }

    // Otherwise, use internal class
    // This should be reliable as if getPrototypeOf not supported, is pre-ES5
    return Object.prototype.toString.call(obj) === '[object Object]';
  }

  // Not an object
  return false;
};

/**
 * @summary Merges the enumerable attributes of two objects
 * @description Replaces arrays and alters the target object.
 * @copyright Nicholas Fisher <nfisher110@gmail.com>
 * @param {Object} target
 * @param {Object} src
 * @returns {Object} target
 */
PSVUtils.deepmerge = function(target, src) {
  var first = src;

  return (function merge(target, src) {
    if (Array.isArray(src)) {
      if (!target || !Array.isArray(target)) {
        target = [];
      }
      else {
        target.length = 0;
      }
      src.forEach(function(e, i) {
        target[i] = merge(null, e);
      });
    }
    else if (typeof src === 'object') {
      if (!target || Array.isArray(target)) {
        target = {};
      }
      Object.keys(src).forEach(function(key) {
        if (typeof src[key] !== 'object' || !src[key] || !PSVUtils.isPlainObject(src[key])) {
          target[key] = src[key];
        }
        else if (src[key] != first) {
          if (!target[key]) {
            target[key] = merge(null, src[key]);
          }
          else {
            merge(target[key], src[key]);
          }
        }
      });
    }
    else {
      target = src;
    }

    return target;
  }(target, src));
};

/**
 * @summary Clones an object
 * @param {Object} src
 * @returns {Object}
 */
PSVUtils.clone = function(src) {
  return PSVUtils.deepmerge(null, src);
};

/**
 * @summary Normalize mousewheel values accross browsers
 * @description From Facebook's Fixed Data Table
 * {@link https://github.com/facebookarchive/fixed-data-table/blob/master/src/vendor_upstream/dom/normalizeWheel.js}
 * @copyright Facebook
 * @param {MouseWheelEvent} event
 * @returns {{spinX: number, spinY: number, pixelX: number, pixelY: number}}
 */
PSVUtils.normalizeWheel = function(event) {
  var PIXEL_STEP  = 10;
  var LINE_HEIGHT = 40;
  var PAGE_HEIGHT = 800;

  var sX = 0, sY = 0; // spinX, spinY
  var pX = 0, pY = 0; // pixelX, pixelY

  // Legacy
  if ('detail'      in event) { sY = event.detail; }
  if ('wheelDelta'  in event) { sY = -event.wheelDelta / 120; }
  if ('wheelDeltaY' in event) { sY = -event.wheelDeltaY / 120; }
  if ('wheelDeltaX' in event) { sX = -event.wheelDeltaX / 120; }

  // side scrolling on FF with DOMMouseScroll
  if ('axis' in event && event.axis === event.HORIZONTAL_AXIS) {
    sX = sY;
    sY = 0;
  }

  pX = sX * PIXEL_STEP;
  pY = sY * PIXEL_STEP;

  if ('deltaY' in event) { pY = event.deltaY; }
  if ('deltaX' in event) { pX = event.deltaX; }

  if ((pX || pY) && event.deltaMode) {
    if (event.deltaMode === 1) { // delta in LINE units
      pX *= LINE_HEIGHT;
      pY *= LINE_HEIGHT;
    }
    else {                      // delta in PAGE units
      pX *= PAGE_HEIGHT;
      pY *= PAGE_HEIGHT;
    }
  }

  // Fall-back if spin cannot be determined
  if (pX && !sX) { sX = (pX < 1) ? -1 : 1; }
  if (pY && !sY) { sY = (pY < 1) ? -1 : 1; }

  return {
    spinX: sX,
    spinY: sY,
    pixelX: pX,
    pixelY: pY
  };
};

/**
 * @callback ForEach
 * @memberOf PSVUtils
 * @param {*} value
 * @param {string} key
 */

/**
 * Loops over enumerable properties of an object
 * @param {object} object
 * @param {ForEach} callback
 */
PSVUtils.forEach = function(object, callback) {
  for (var key in object) {
    if (object.hasOwnProperty(key)) {
      callback(object[key], key);
    }
  }
};


/**
 * requestAnimationFrame polyfill
 * {@link http://mattsnider.com/cross-browser-and-legacy-supported-requestframeanimation}
 * @license MIT
 */
(function(w) {
    "use strict";
    // most browsers have an implementation
    w.requestAnimationFrame = w.requestAnimationFrame ||
            w.mozRequestAnimationFrame || w.webkitRequestAnimationFrame ||
            w.msRequestAnimationFrame;
    w.cancelAnimationFrame = w.cancelAnimationFrame ||
            w.mozCancelAnimationFrame || w.webkitCancelAnimationFrame ||
            w.msCancelAnimationFrame;

    // polyfill, when necessary
    if (!w.requestAnimationFrame) {
        var aAnimQueue = [],
            aProcessing = [],
            iRequestId = 0,
            iIntervalId;

        // create a mock requestAnimationFrame function
        w.requestAnimationFrame = function(callback) {
            aAnimQueue.push([++iRequestId, callback]);

            if (!iIntervalId) {
                iIntervalId = setInterval(function() {
                    if (aAnimQueue.length) {
                        var time = +new Date();
                        // Process all of the currently outstanding frame
                        // requests, but none that get added during the
                        // processing.
                        // Swap the arrays so we don't have to create a new
                        // array every frame.
                        var temp = aProcessing;
                        aProcessing = aAnimQueue;
                        aAnimQueue = temp;
                        while (aProcessing.length) {
                            aProcessing.shift()[1](time);
                        }
                    } else {
                        // don't continue the interval, if unnecessary
                        clearInterval(iIntervalId);
                        iIntervalId = undefined;
                    }
                }, 1000 / 50);  // estimating support for 50 frames per second
            }

            return iRequestId;
        };

        // create a mock cancelAnimationFrame function
        w.cancelAnimationFrame = function(requestId) {
            // find the request ID and remove it
            var i, j;
            for (i = 0, j = aAnimQueue.length; i < j; i += 1) {
                if (aAnimQueue[i][0] === requestId) {
                    aAnimQueue.splice(i, 1);
                    return;
                }
            }

            // If it's not in the queue, it may be in the set we're currently
            // processing (if cancelAnimationFrame is called from within a
            // requestAnimationFrame callback).
            for (i = 0, j = aProcessing.length; i < j; i += 1) {
                if (aProcessing[i][0] === requestId) {
                    aProcessing.splice(i, 1);
                    return;
                }
            }
        };
    }
})(window);


PhotoSphereViewer.ICONS['compass.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 0a50 50 0 1 0 0 100A50 50 0 0 0 50 0zm0 88.81a38.86 38.86 0 0 1-38.81-38.8 38.86 38.86 0 0 1 38.8-38.82A38.86 38.86 0 0 1 88.82 50 38.87 38.87 0 0 1 50 88.81z"/><path d="M72.07 25.9L40.25 41.06 27.92 74.12l31.82-15.18v-.01l12.32-33.03zM57.84 54.4L44.9 42.58l21.1-10.06-8.17 21.9z"/><!--Created by iconoci from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['download.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M83.3 35.6h-17V3H32.2v32.6H16.6l33.6 32.7 33-32.7z"/><path d="M83.3 64.2v16.3H16.6V64.2H-.1v32.6H100V64.2H83.3z"/><!--Created by Michael Zenaty from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['fullscreen-in.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M100 40H87.1V18.8h-21V6H100zM100 93.2H66V80.3h21.1v-21H100zM34 93.2H0v-34h12.9v21.1h21zM12.9 40H0V6h34v12.9H12.8z"/><!--Created by Garrett Knoll from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['fullscreen-out.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M66 7h13v21h21v13H66zM66 60.3h34v12.9H79v21H66zM0 60.3h34v34H21V73.1H0zM21 7h13v34H0V28h21z"/><!--Created by Garrett Knoll from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['info.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M28.3 26.1c-1 2.6-1.9 4.8-2.6 7-2.5 7.4-5 14.7-7.2 22-1.3 4.4.5 7.2 4.3 7.8 1.3.2 2.8.2 4.2-.1 8.2-2 11.9-8.6 15.7-15.2l-2.2 2a18.8 18.8 0 0 1-7.4 5.2 2 2 0 0 1-1.6-.2c-.2-.1 0-1 0-1.4l.8-1.8L41.9 28c.5-1.4.9-3 .7-4.4-.2-2.6-3-4.4-6.3-4.4-8.8.2-15 4.5-19.5 11.8-.2.3-.2.6-.3 1.3 3.7-2.8 6.8-6.1 11.8-6.2z"/><circle cx="39.3" cy="9.2" r="8.2"/><!--Created by Arafat Uddin from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['mobile-rotate.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M66.7 19a14 14 0 0 1 13.8 12.1l-3.9-2.7c-.5-.3-1.1-.2-1.4.3-.3.5-.2 1.1.3 1.4l5.7 3.9.6.2c.3 0 .6-.2.8-.4l3.9-5.7c.3-.5.2-1.1-.3-1.4-.5-.3-1.1-.2-1.4.3l-2.4 3.5A16 16 0 0 0 66.7 17c-.6 0-1 .4-1 1s.4 1 1 1zM25 15h10c.6 0 1-.4 1-1s-.4-1-1-1H25c-.6 0-1 .4-1 1s.4 1 1 1zm-6.9 30H16l-2 .2a1 1 0 0 0-.8 1.2c.1.5.5.8 1 .8h.2l1.7-.2h2.1c.6 0 1-.4 1-1s-.5-1-1.1-1zm10 0h-4c-.6 0-1 .4-1 1s.4 1 1 1h4c.6 0 1-.4 1-1s-.4-1-1-1zM84 45H55V16A11 11 0 0 0 44 5H16A11 11 0 0 0 5 16v68a11 11 0 0 0 11 11h68a11 11 0 0 0 11-11V56a11 11 0 0 0-11-11zM16 93c-5 0-9-4-9-9V53.2c.3-.1.6-.3.7-.6a9.8 9.8 0 0 1 2-3c.4-.4.4-1 0-1.4a1 1 0 0 0-1.4 0l-1.2 1.5V16c0-5 4-9 9-9h28c5 0 9 4 9 9v68c0 5-4 9-9 9H16zm77-9c0 5-4 9-9 9H50.3c2.8-2 4.7-5.3 4.7-9V47h29c5 0 9 4 9 9v28zM38.1 45h-4c-.6 0-1 .4-1 1s.4 1 1 1h4c.6 0 1-.4 1-1s-.5-1-1-1zm9.9 0h-4c-.6 0-1 .4-1 1s.4 1 1 1h4c.6 0 1-.4 1-1s-.4-1-1-1zm38 19c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1s1-.4 1-1V65c0-.6-.4-1-1-1z"/><!--Created by Anthony Bresset from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['pin.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 0C13.8 0 5.5 8.3 5.5 18.5c0 10.07 17.57 28.64 18.32 29.42a.25.25 0 0 0 .36 0c.75-.78 18.32-19.35 18.32-29.42C42.5 8.3 34.2 0 24 0zm0 7.14a10.35 10.35 0 0 1 0 20.68 10.35 10.35 0 0 1 0-20.68z"/><!--Created by Daniele Marucci from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['play-active.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41"><path d="M40.5 14.1c-.1-.1-1.2-.5-2.898-1-.102 0-.202-.1-.202-.2C34.5 6.5 28 2 20.5 2S6.6 6.5 3.7 12.9c0 .1-.1.1-.2.2-1.7.6-2.8 1-2.9 1l-.6.3v12.1l.6.2c.1 0 1.1.399 2.7.899.1 0 .2.101.2.199C6.3 34.4 12.9 39 20.5 39c7.602 0 14.102-4.6 16.9-11.1 0-.102.1-.102.199-.2 1.699-.601 2.699-1 2.801-1l.6-.3V14.3l-.5-.2zM6.701 11.5C9.7 7 14.8 4 20.5 4c5.8 0 10.9 3 13.8 7.5.2.3-.1.6-.399.5-3.799-1-8.799-2-13.6-2-4.7 0-9.5 1-13.2 2-.3.1-.5-.2-.4-.5zM25.1 20.3L18.7 24c-.3.2-.7 0-.7-.5v-7.4c0-.4.4-.6.7-.4l6.399 3.8c.301.1.301.6.001.8zm9.4 8.901A16.421 16.421 0 0 1 20.5 37c-5.9 0-11.1-3.1-14-7.898-.2-.302.1-.602.4-.5 3.9 1 8.9 2.1 13.6 2.1 5 0 9.9-1 13.602-2 .298-.1.5.198.398.499z"/><!--Created by Nick Bluth from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['play.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 41"><path d="M40.5 14.1c-.1-.1-1.2-.5-2.899-1-.101 0-.2-.1-.2-.2C34.5 6.5 28 2 20.5 2S6.6 6.5 3.7 12.9c0 .1-.1.1-.2.2-1.7.6-2.8 1-2.9 1l-.6.3v12.1l.6.2c.1 0 1.1.4 2.7.9.1 0 .2.1.2.199C6.3 34.4 12.9 39 20.5 39c7.601 0 14.101-4.6 16.9-11.1 0-.101.1-.101.2-.2 1.699-.6 2.699-1 2.8-1l.6-.3V14.3l-.5-.2zM20.5 4c5.8 0 10.9 3 13.8 7.5.2.3-.1.6-.399.5-3.8-1-8.8-2-13.6-2-4.7 0-9.5 1-13.2 2-.3.1-.5-.2-.4-.5C9.7 7 14.8 4 20.5 4zm0 33c-5.9 0-11.1-3.1-14-7.899-.2-.301.1-.601.4-.5 3.9 1 8.9 2.1 13.6 2.1 5 0 9.9-1 13.601-2 .3-.1.5.2.399.5A16.422 16.422 0 0 1 20.5 37zm18.601-12.1c0 .1-.101.3-.2.3-2.5.9-10.4 3.6-18.4 3.6-7.1 0-15.6-2.699-18.3-3.6C2.1 25.2 2 25 2 24.9V16c0-.1.1-.3.2-.3 2.6-.9 10.6-3.6 18.2-3.6 7.5 0 15.899 2.7 18.5 3.6.1 0 .2.2.2.3v8.9z"/><path d="M18.7 24l6.4-3.7c.3-.2.3-.7 0-.8l-6.4-3.8c-.3-.2-.7 0-.7.4v7.4c0 .5.4.7.7.5z"/><!--Created by Nick Bluth from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['stereo.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 16 16"><path d="M13.104 0H2.896C2.332 0 1 .392 1 .875h14C15 .392 13.668 0 13.104 0zM15 1H1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3.534a2 2 0 0 0 1.821-1.172l1.19-2.618a.5.5 0 0 1 .91 0l1.19 2.618A2 2 0 0 0 11.466 11H15a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM4 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/><!--Created by Idevã Batista from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['zoom-in.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M14.043 12.22a7.738 7.738 0 1 0-1.823 1.822l4.985 4.985c.503.504 1.32.504 1.822 0a1.285 1.285 0 0 0 0-1.822l-4.984-4.985zm-6.305 1.043a5.527 5.527 0 1 1 0-11.053 5.527 5.527 0 0 1 0 11.053z"/><path d="M8.728 4.009H6.744v2.737H4.006V8.73h2.738v2.736h1.984V8.73h2.737V6.746H8.728z"/><!--Created by Ryan Canning from the Noun Project--></svg>';

PhotoSphereViewer.ICONS['zoom-out.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M14.043 12.22a7.738 7.738 0 1 0-1.823 1.822l4.985 4.985c.503.504 1.32.504 1.822 0a1.285 1.285 0 0 0 0-1.822l-4.984-4.985zm-6.305 1.043a5.527 5.527 0 1 1 0-11.053 5.527 5.527 0 0 1 0 11.053z"/><path d="M4.006 6.746h7.459V8.73H4.006z"/><!--Created by Ryan Canning from the Noun Project--></svg>';
return PhotoSphereViewer;
}));
