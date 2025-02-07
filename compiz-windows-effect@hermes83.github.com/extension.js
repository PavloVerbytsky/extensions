/*
 * Compiz-windows-effect for GNOME Shell
 *
 * Copyright (C) 2020
 *     Mauro Pepe <https://github.com/hermes83/compiz-windows-effect>
 *
 * This file is part of the gnome-shell extension Compiz-windows-effect.
 *
 * gnome-shell extension Compiz-windows-effect is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * gnome-shell extension Compiz-windows-effect is distributed in the hope that it
 * will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE.  See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell extension Compiz-windows-effect.  If not, see
 * <http://www.gnu.org/licenses/>.
 */
'use strict';

const { GObject, Clutter, Meta } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const Settings = Extension.imports.settings;
const Config = imports.misc.config;

const IS_4_XX_SHELL_VERSION = Config.PACKAGE_VERSION.startsWith("4");
const IS_3_XX_SHELL_VERSION = Config.PACKAGE_VERSION.startsWith("3");
const IS_3_38_SHELL_VERSION = Config.PACKAGE_VERSION.startsWith("3.38");

let compizWindowsEffectExtension;

function init() {}

function enable() {
    compizWindowsEffectExtension = new CompizWindowsEffectExtension();
    if (compizWindowsEffectExtension) {
        compizWindowsEffectExtension.enable();
    }
}   

function disable() {
    if (compizWindowsEffectExtension) {
        compizWindowsEffectExtension.disable();
        compizWindowsEffectExtension = null;
    }
}

class CompizWindowsEffectExtension {
    constructor() {
        this.EFFECT_NAME = 'wobbly-compiz-effect';

        this.prefs = new Settings.Prefs();

        this.allowedGrabOp = [Meta.GrabOp.MOVING, Meta.GrabOp.NONE];
        this.allowedResizeOp = [Meta.GrabOp.RESIZING_W, Meta.GrabOp.RESIZING_E, Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_NW, Meta.GrabOp.RESIZING_NE, Meta.GrabOp.RESIZING_SE, Meta.GrabOp.RESIZING_SW];

        this.grabOpBeginId = null;
        this.grabOpEndId = null;
        this.maximizeOpId = null;
        this.unmaximizeOpId = null;
        this.destroyId = null;
    }

    enable() {
        if (IS_3_XX_SHELL_VERSION) {
            this.grabOpBeginId = global.display.connect('grab-op-begin', (display, screen, window, op) => {
                this.grabStart(window, op);
            });
        } else {
            this.grabOpBeginId = global.display.connect('grab-op-begin', (display, window, op) => {
                this.grabStart(window, op);
            });
        }
    
        if (IS_3_XX_SHELL_VERSION) {
            this.grabOpEndId = global.display.connect('grab-op-end', (display, screen, window, op) => {  
                this.grabEnd(window, op);
            });
        } else {
            this.grabOpEndId = global.display.connect('grab-op-end', (display, window, op) => {  
                this.grabEnd(window, op);
            });
        }

        this.maximizeOpId = global.window_manager.connect('size-changed', (wm, actor) => {
            if (!actor || !actor.__animationInfo || !actor.metaWindow.get_maximized()) {
                return;
            }

            this.destroyActorEffect(actor);

            if (!this.prefs.MAXIMIZE_EFFECT.get()) {
                return;
            }

            let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
            let targetRect = actor.meta_window.get_frame_rect();
            let sourceRect = actor.__animationInfo.oldRect;

            if (actor.metaWindow.get_maximized() == Meta.MaximizeFlags.BOTH || (
                actor.metaWindow.get_maximized() == Meta.MaximizeFlags.VERTICAL && (
                    sourceRect.x == monitor.x && targetRect.x != monitor.x || 
                    sourceRect.x != monitor.x && targetRect.x == monitor.x ||
                    sourceRect.x + sourceRect.width == monitor.x + monitor.width && targetRect.x + targetRect.width != monitor.x + monitor.width || 
                    sourceRect.x + sourceRect.width != monitor.x + monitor.width && targetRect.x + targetRect.width == monitor.x + monitor.width))) 
            {        
                actor.add_effect_with_name(this.EFFECT_NAME, new WobblyEffect({op: 'maximized'}));
            }
        });

        this.unmaximizeOpId = global.window_manager.connect('size-change', (wm, actor, op, oldFrameRect, oldBufferRect) => {
            if (!actor || !op || !this.isManagedOp(op)) {
                return;
            }

            let effect = actor.get_effect(this.EFFECT_NAME);
            if (!effect || effect.operationType != 'move') {
                this.destroyActorEffect(actor);
    
                actor.add_effect_with_name(this.EFFECT_NAME, new WobblyEffect({op: 'unmaximized'}));
            }
        });

        this.destroyId = global.window_manager.connect("destroy", (wm, actor) => {
            this.destroyActorEffect(actor);
        });    
    }

    disable() {
        if (this.prefs) {
            this.prefs = null;
        }
        if (this.allowedGrabOp) {
            this.allowedGrabOp = null;
        }
        if (this.allowedResizeOp) {
            this.allowedResizeOp = null;
        }
        if (this.grabOpBeginId) {
            global.display.disconnect(this.grabOpBeginId);
            this.grabOpBeginId = null;
        }
        if (this.grabOpEndId) {
            global.display.disconnect(this.grabOpEndId);
            this.grabOpEndId = null;
        }
        if (this.maximizeOpId) {
            global.window_manager.disconnect(this.maximizeOpId);
            this.maximizeOpId = null;
        }
        if (this.unmaximizeOpId) {
            global.window_manager.disconnect(this.unmaximizeOpId);
            this.unmaximizeOpId = null;
        }
        if (this.destroyId) {
            global.window_manager.disconnect(this.destroyId);
            this.destroyId = null;
        }
        
        global.get_window_actors().forEach((actor) => {
            this.destroyActorEffect(actor);
        });
    }

    grabStart(window, op) {
        if (!this.isManagedOp(op)) {
            return;
        }
        
        let actor = window ? window.get_compositor_private() : null;
        if (!actor) {
            return;
        }

        this.destroyActorEffect(actor);

        if (Meta.GrabOp.MOVING == op) {
            actor.add_effect_with_name(this.EFFECT_NAME, new WobblyEffect({op: 'move'}));
        } else {
            actor.add_effect_with_name(this.EFFECT_NAME, new ResizeEffect({op: op}));
        }
    }
    
    grabEnd(window, op) {
        let actor = window ? window.get_compositor_private() : null;
        if (!actor) {
            return;
        }
         
        var effect = actor.get_effect(this.EFFECT_NAME);
        if (effect) {
            effect.on_end_event(actor);
        }
    }

    destroyActorEffect(actor) {
        if (!actor) {
            return;
        }

        let effect = actor.get_effect(this.EFFECT_NAME);
        if (effect) {
            effect.destroy();
        }
    }

    isManagedOp(op) {
        return this.allowedGrabOp.indexOf(op) > -1 || (this.prefs.RESIZE_EFFECT.get() && this.allowedResizeOp.indexOf(op) > -1);
    }
}

const WobblyEffectBase = GObject.registerClass({}, 
    class WobblyEffectBase extends Clutter.DeformEffect {

        _init(params = {}) {
            super._init();
            this.operationType = params.op;

            this.CLUTTER_TIMELINE_DURATION = 1000 * 1000;

            this.paintEvent = null;
            this.moveEvent = null;
            this.newFrameEvent = null;
            this.completedEvent = null;
            this.overviewShowingEvent = null;
            
            this.timerId = null;
            this.width = 0;
            this.height = 0;
            this.deltaX = 0;
            this.deltaY = 0;
            this.mouseX = 0;
            this.mouseY = 0;
            this.msecOld = 0;

            this.wobblyModel = null;
            this.coeff = null;
            this.deformedObjects = null;
            this.tilesX = 0;
            this.tilesY = 0;
            
            let prefs = (new Settings.Prefs());
            this.FRICTION = prefs.FRICTION.get();
            this.SPRING_K = prefs.SPRING_K.get();            
            this.SPEEDUP_FACTOR = prefs.SPEEDUP_FACTOR.get();
            this.MASS = prefs.MASS.get();
            this.X_TILES = 'maximized' == this.operationType ? 10 : prefs.X_TILES.get();
            this.Y_TILES = 'maximized' == this.operationType ? 10 : prefs.Y_TILES.get();

            this.set_n_tiles(this.X_TILES, this.Y_TILES);
            
            this.initialized = false;
            this.ended = false;
        }

        vfunc_set_actor(actor) {
            super.vfunc_set_actor(actor);

            if (actor && !this.initialized) {
                this.initialized = true;

                [this.width, this.height] = actor.get_size();
                [this.newX, this.newY] = [actor.get_x(), actor.get_y()];
                [this.oldX, this.oldY] = [this.newX, this.newY];
                [this.mouseX, this.mouseY] = global.get_pointer();
                [this.tilesX, this.tilesY] = [this.X_TILES + 0.1, this.Y_TILES + 0.1];

                this.coeff = new Array(this.Y_TILES + 1);
                this.deformedObjects = new Array(this.Y_TILES + 1);
            
                var x, y, tx, ty;
                for (y = this.Y_TILES; y >= 0; y--) {
                    ty = y / this.Y_TILES;

                    this.coeff[y] = new Array(this.X_TILES + 1);
                    this.deformedObjects[y] = new Array(this.X_TILES + 1);
            
                    for (x = this.X_TILES; x >= 0; x--) {
                        tx = x / this.X_TILES;
        
                        this.coeff[y][x] = [
                            (1 - tx) * (1 - tx) * (1 - tx) * (1 - ty) * (1 - ty) * (1 - ty),
                            3 * tx * (1 - tx) * (1 - tx) * (1 - ty) * (1 - ty) * (1 - ty),
                            3 * tx * tx * (1 - tx) * (1 - ty) * (1 - ty) * (1 - ty),
                            tx * tx * tx * (1 - ty) * (1 - ty) * (1 - ty),
                            3 * (1 - tx) * (1 - tx) * (1 - tx) * ty * (1 - ty) * (1 - ty),
                            9 * tx * (1 - tx) * (1 - tx) * ty * (1 - ty) * (1 - ty),
                            9 * tx * tx * (1 - tx) * ty * (1 - ty) * (1 - ty),
                            3 * tx * tx * tx * ty * (1 - ty) * (1 - ty),
                            3 * (1 - tx) * (1 - tx) * (1 - tx) * ty * ty * (1 - ty),
                            3 * tx * (1 - tx) * (1 - tx) * 3 * ty * ty * (1 - ty),
                            9 * tx * tx * (1 - tx) * ty * ty * (1 - ty),
                            3 * tx * tx * tx * ty * ty * (1 - ty),
                            (1 - tx) * (1 - tx) * (1 - tx) * ty * ty * ty,
                            3 * tx * (1 - tx) * (1 - tx) * ty * ty * ty,
                            3 * tx * tx * (1 - tx) * ty * ty * ty,
                            tx * tx * tx * ty * ty * ty
                        ];

                        this.deformedObjects[y][x] = [tx * this.width, ty * this.height];
                    }
                }

                this.wobblyModel = new WobblyModel({friction: this.FRICTION, springK: this.SPRING_K, mass: this.MASS, sizeX: this.width, sizeY: this.height});
                
                if ('unmaximized' == this.operationType) {
                    this.wobblyModel.unmaximize();
                    this.ended = true;
                } else if ('maximized' == this.operationType) {                    
                    this.wobblyModel.maximize();
                    this.ended = true;
                } else {
                    this.wobblyModel.grab(this.mouseX - this.newX, this.mouseY - this.newY);
                    this.moveEvent = actor.connect(IS_4_XX_SHELL_VERSION || IS_3_38_SHELL_VERSION ? 'notify::allocation' : 'allocation-changed', this.on_move_event.bind(this));
                    this.resizedEvent = actor.connect('notify::size', this.on_resized_event.bind(this));
                }

                if (IS_3_XX_SHELL_VERSION) {
                    this.paintEvent = actor.connect('paint', () => {});
                }
                this.overviewShowingEvent = Main.overview.connect('showing', this.destroy.bind(this));

                this.timerId = IS_4_XX_SHELL_VERSION || IS_3_38_SHELL_VERSION ? new Clutter.Timeline({actor: actor, duration: this.CLUTTER_TIMELINE_DURATION}) : new Clutter.Timeline({duration: this.CLUTTER_TIMELINE_DURATION});
                this.newFrameEvent = this.timerId.connect('new-frame', this.on_new_frame_event.bind(this));
                this.completedEvent = this.timerId.connect('completed', this.destroy.bind(this));
                this.timerId.start();      
            }
        }

        destroy() {
            if (this.overviewShowingEvent) {
                Main.overview.disconnect(this.overviewShowingEvent);
            }

            if (this.timerId) {
                if (this.completedEvent) {
                    this.timerId.disconnect(this.completedEvent);
                    this.completedEvent = null;
                }
                if (this.newFrameEvent) {
                    this.timerId.disconnect(this.newFrameEvent);
                    this.newFrameEvent = null;
                }
                this.timerId.run_dispose();
                this.timerId = null;
            }

            if (this.wobblyModel) {
                this.wobblyModel.dispose();
                this.wobblyModel = null;
            }
            
            let actor = this.get_actor();
            if (actor) {
                if (this.paintEvent) {
                    actor.disconnect(this.paintEvent);
                    this.paintEvent = null;
                }

                if (this.moveEvent) {
                    actor.disconnect(this.moveEvent);
                    this.moveEvent = null;
                }

                if (this.resizedEvent) {
                    actor.disconnect(this.resizedEvent);
                    this.resizedEvent = null;
                }

                actor.remove_effect(this);
            }
        }

        on_end_event(actor) {
            this.ended = true;
        }   

        on_move_event(actor, allocation, flags) {
            [this.oldX, this.oldY, this.newX, this.newY] = [this.newX, this.newY, actor.get_x(), actor.get_y()];
            this.wobblyModel.move(this.newX - this.oldX, this.newY - this.oldY);
            this.deltaX -= this.newX - this.oldX;
            this.deltaY -= this.newY - this.oldY;
        }

        on_resized_event(actor, params) {
            var [width, height] = actor.get_size();
            if (this.width != width || this.height != height) {
                [this.width, this.height] = [width, height];
                this.wobblyModel.resize(this.width, this.height);
                [this.deltaX, this.deltaY] = [0, 0];
            }
        }

        on_new_frame_event(timer, msec) {
            if (this.ended && (!this.timerId || !this.wobblyModel || !this.wobblyModel.movement)) {
                this.destroy();
                return;
            }

            this.wobblyModel.step((msec - this.msecOld) / this.SPEEDUP_FACTOR);
            this.msecOld = msec;

            var x, y;
            for (y = this.Y_TILES; y >= 0 ; y--) {
                for (x = this.X_TILES; x >= 0; x--) {
                    this.deformedObjects[y][x][0] = 
                        this.coeff[y][x][0] * this.wobblyModel.objects[0].x
                        + this.coeff[y][x][1] * this.wobblyModel.objects[1].x
                        + this.coeff[y][x][2] * this.wobblyModel.objects[2].x
                        + this.coeff[y][x][3] * this.wobblyModel.objects[3].x
                        + this.coeff[y][x][4] * this.wobblyModel.objects[4].x
                        + this.coeff[y][x][5] * this.wobblyModel.objects[5].x
                        + this.coeff[y][x][6] * this.wobblyModel.objects[6].x
                        + this.coeff[y][x][7] * this.wobblyModel.objects[7].x
                        + this.coeff[y][x][8] * this.wobblyModel.objects[8].x
                        + this.coeff[y][x][9] * this.wobblyModel.objects[9].x
                        + this.coeff[y][x][10] * this.wobblyModel.objects[10].x
                        + this.coeff[y][x][11] * this.wobblyModel.objects[11].x
                        + this.coeff[y][x][12] * this.wobblyModel.objects[12].x
                        + this.coeff[y][x][13] * this.wobblyModel.objects[13].x
                        + this.coeff[y][x][14] * this.wobblyModel.objects[14].x
                        + this.coeff[y][x][15] * this.wobblyModel.objects[15].x;
                    this.deformedObjects[y][x][1] = 
                        this.coeff[y][x][0] * this.wobblyModel.objects[0].y
                        + this.coeff[y][x][1] * this.wobblyModel.objects[1].y
                        + this.coeff[y][x][2] * this.wobblyModel.objects[2].y
                        + this.coeff[y][x][3] * this.wobblyModel.objects[3].y
                        + this.coeff[y][x][4] * this.wobblyModel.objects[4].y
                        + this.coeff[y][x][5] * this.wobblyModel.objects[5].y
                        + this.coeff[y][x][6] * this.wobblyModel.objects[6].y
                        + this.coeff[y][x][7] * this.wobblyModel.objects[7].y
                        + this.coeff[y][x][8] * this.wobblyModel.objects[8].y
                        + this.coeff[y][x][9] * this.wobblyModel.objects[9].y
                        + this.coeff[y][x][10] * this.wobblyModel.objects[10].y
                        + this.coeff[y][x][11] * this.wobblyModel.objects[11].y
                        + this.coeff[y][x][12] * this.wobblyModel.objects[12].y
                        + this.coeff[y][x][13] * this.wobblyModel.objects[13].y
                        + this.coeff[y][x][14] * this.wobblyModel.objects[14].y
                        + this.coeff[y][x][15] * this.wobblyModel.objects[15].y;
                }
            }

            this.invalidate();
        }

        vfunc_deform_vertex(w, h, v) {
            [v.x, v.y] = this.deformedObjects[v.ty * this.tilesY >> 0][v.tx * this.tilesX >> 0];
            v.x = (v.x + this.deltaX) * w / this.width;
            v.y = (v.y + this.deltaY) * h / this.height;
        }
    }
);

const ResizeEffectBase = GObject.registerClass({}, 
    class ResizeEffectBase extends Clutter.DeformEffect {

        _init(params = {}) {
            super._init();
            this.operationType = params.op;

            this.CLUTTER_TIMELINE_END_RESIZE_EFFECT_DURATION = 1000;

            this.paintEvent = null;
            this.moveEvent = null;
            this.newFrameEvent = null;
            this.completedEvent = null;
            
            this.i = 0;
            this.j = 0;
            this.k = 0;
            this.xPickedUp = 0;
            this.yPickedUp = 0;
            this.width = 0;
            this.height = 0;
            this.xNew = 0;
            this.yNew = 0;
            this.xOld = 0;
            this.yOld = 0;
            this.xDelta = 0;
            this.yDelta = 0;
            this.msecOld = 0;
            
            this.xDeltaStop = 0;
            this.yDeltaStop = 0;
            this.xDeltaStopMoving = 0;
            this.yDeltaStopMoving = 0;
            this.timerId = null;

            //Init stettings 
            let prefs = (new Settings.Prefs());

            this.END_EFFECT_MULTIPLIER = prefs.FRICTION.get() * 10 + 10;
            this.END_EFFECT_DIVIDER = 4;
            this.X_MULTIPLIER = prefs.SPRING_K.get() * 2 / 10;
            this.Y_MULTIPLIER = prefs.SPRING_K.get() * 2 / 10;
            this.CORNER_RESIZING_DIVIDER = 6;
        
            this.X_TILES = 20;
            this.Y_TILES = 20;

            this.set_n_tiles(this.X_TILES, this.Y_TILES);

            this.initialized = false;
        }

        vfunc_set_actor(actor) {
            super.vfunc_set_actor(actor);

            if (actor && !this.initialized) {
                this.initialized = true;

                [this.width, this.height] = actor.get_size();
                [this.xNew, this.yNew] = global.get_pointer();

                let [xWin, yWin] = actor.get_position();

                [this.xOld, this.yOld] = [this.xNew, this.yNew];
                [this.xPickedUp, this.yPickedUp] = [this.xNew - xWin, this.yNew - yWin];
                
                if (IS_3_XX_SHELL_VERSION) {
                    this.paintEvent = actor.connect('paint', () => {});
                }
                this.moveEvent = actor.connect('notify::allocation', this.on_move_event.bind(this));
            }
        }

        destroy() {
            if (this.timerId) {
                if (this.completedEvent) {
                    this.timerId.disconnect(this.completedEvent);
                    this.completedEvent = null;
                }
                if (this.newFrameEvent) {
                    this.timerId.disconnect(this.newFrameEvent);
                    this.newFrameEvent = null;
                }
                this.timerId.run_dispose();
                this.timerId = null;
            }

            let actor = this.get_actor();
            if (actor) {            
                if (this.paintEvent) {
                    actor.disconnect(this.paintEvent);
                    this.paintEvent = null;
                }

                if (this.moveEvent) {
                    actor.disconnect(this.moveEvent);
                    this.moveEvent = null;
                }

                actor.remove_effect(this);
            }
        }

        on_end_event(actor) {
            [this.xDeltaStop, this.yDeltaStop] = [this.xDelta * 1.5, this.yDelta * 1.5];
            [this.xDeltaStopMoving, this.yDeltaStopMoving] = [0, 0];
            
            this.timerId = IS_4_XX_SHELL_VERSION || IS_3_38_SHELL_VERSION ? new Clutter.Timeline({actor: actor, duration: this.CLUTTER_TIMELINE_END_RESIZE_EFFECT_DURATION}) : new Clutter.Timeline({duration: this.CLUTTER_TIMELINE_END_RESIZE_EFFECT_DURATION});
            this.newFrameEvent = this.timerId.connect('new-frame', this.on_stop_effect_event.bind(this));
            this.completedEvent = this.timerId.connect('completed', this.destroy.bind(this));
            this.timerId.start();      
        }   

        on_stop_effect_event(timer, msec) {
            this.i = timer.get_progress() * this.END_EFFECT_MULTIPLIER;    
            this.xDelta = Math.trunc(this.xDeltaStop * Math.sin(this.i) / Math.exp(this.i / this.END_EFFECT_DIVIDER, 2));
            this.yDelta = Math.trunc(this.yDeltaStop * Math.sin(this.i) / Math.exp(this.i / this.END_EFFECT_DIVIDER, 2));

            this.invalidate();
        }

        on_move_event(actor, allocation, flags) {
            [this.xNew, this.yNew] = global.get_pointer();

            this.xDelta += (this.xOld - this.xNew) * this.X_MULTIPLIER;
            this.yDelta += (this.yOld - this.yNew) * this.Y_MULTIPLIER;

            [this.xOld, this.yOld] = [this.xNew, this.yNew];
        }

        vfunc_deform_vertex(w, h, v) {
            switch (this.operationType) {
                case Meta.GrabOp.RESIZING_W:
                    v.x += this.xDelta * (w - v.x) * Math.pow(v.y - this.yPickedUp, 2) / (Math.pow(h, 2) * w);
                    break;

                case Meta.GrabOp.RESIZING_E:
                    v.x += this.xDelta * v.x * Math.pow(v.y - this.yPickedUp, 2) / (Math.pow(h, 2) * w);
                    break;

                case Meta.GrabOp.RESIZING_S:
                    v.y += this.yDelta * v.y * Math.pow(v.x - this.xPickedUp, 2) / (Math.pow(w, 2) * h);
                    break;

                case Meta.GrabOp.RESIZING_N:
                    v.y += this.yDelta * (h - v.y) * Math.pow(v.x - this.xPickedUp, 2) / (Math.pow(w, 2) * h);
                    break;      

                case Meta.GrabOp.RESIZING_NW:
                    v.x += this.xDelta / this.CORNER_RESIZING_DIVIDER * (w - v.x) * Math.pow(v.y, 2) / (Math.pow(h, 2) * w);
                    v.y +=  this.yDelta / this.CORNER_RESIZING_DIVIDER * (h - v.y) * Math.pow(v.x, 2) / (Math.pow(w, 2) * h);  
                    break;
                    
                case Meta.GrabOp.RESIZING_NE:
                    v.x += this.xDelta / this.CORNER_RESIZING_DIVIDER * v.x * Math.pow(v.y, 2) / (Math.pow(h, 2) * w);
                    v.y += this.yDelta / this.CORNER_RESIZING_DIVIDER * (h - v.y) * Math.pow(w - v.x, 2) / (Math.pow(w, 2) * h);    
                    break;

                case Meta.GrabOp.RESIZING_SE:
                    v.x += this.xDelta / this.CORNER_RESIZING_DIVIDER * v.x * Math.pow(h - v.y, 2) / (Math.pow(h, 2) * w);
                    v.y += this.yDelta / this.CORNER_RESIZING_DIVIDER * v.y * Math.pow(w - v.x, 2) / (Math.pow(w, 2) * h);    
                    break;

                case Meta.GrabOp.RESIZING_SW:
                    v.x += this.xDelta / this.CORNER_RESIZING_DIVIDER * (w - v.x) * Math.pow(v.y - h, 2) / (Math.pow(h, 2) * w);
                    v.y += this.yDelta / this.CORNER_RESIZING_DIVIDER * v.y * Math.pow(v.x, 2) / (Math.pow(w, 2) * h);
                    break;          
            }

        }
    }
);

var WobblyEffect;
var ResizeEffect;

if (IS_4_XX_SHELL_VERSION) { 
    WobblyEffect = GObject.registerClass({}, class WobblyEffect extends WobblyEffectBase {            
        vfunc_modify_paint_volume(pv) {
            return false;
        }
    });
    ResizeEffect = GObject.registerClass({}, class ResizeEffect extends ResizeEffectBase {            
        vfunc_modify_paint_volume(pv) {
            return false;
        }
    });
} else {
    WobblyEffect = WobblyEffectBase;
    ResizeEffect = ResizeEffectBase;
}

/*
 * Copyright © 2005 Novell, Inc.
 * Copyright © 2022 Mauro Pepe
 *
 * Permission to use, copy, modify, distribute, and sell this software
 * and its documentation for any purpose is hereby granted without
 * fee, provided that the above copyright notice appear in all copies
 * and that both that copyright notice and this permission notice
 * appear in supporting documentation, and that the name of
 * Novell, Inc. not be used in advertising or publicity pertaining to
 * distribution of the software without specific, written prior permission.
 * Novell, Inc. makes no representations about the suitability of this
 * software for any purpose. It is provided "as is" without express or
 * implied warranty.
 *
 * NOVELL, INC. DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE,
 * INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS, IN
 * NO EVENT SHALL NOVELL, INC. BE LIABLE FOR ANY SPECIAL, INDIRECT OR
 * CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
 * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION
 * WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Author: David Reveman <davidr@novell.com>
 *         Scott Moreau <oreaus@gmail.com>
 *         Mauro Pepe <https://github.com/hermes83/compiz-windows-effect>
 *
 * Spring model implemented by Kristian Hogsberg.
 */

class Obj {
    constructor(forceX, forceY, positionX, positionY, velocityX, velocityY, immobile) {
        [this.forceX, this.forceY, this.x, this.y, this.velocityX, this.velocityY, this.immobile] = [forceX, forceY, positionX, positionY, velocityX, velocityY, immobile];
    }    
}

class Spring {
    constructor(a, b, offsetX, offsetY) {
        [this.a, this.b, this.offsetX, this.offsetY] = [a, b, offsetX, offsetY];
    }
}

class WobblyModel {
    constructor(config) {
        this.GRID_WIDTH = 4;
        this.GRID_HEIGHT = 4;

        this.objects = new Array(this.GRID_WIDTH * this.GRID_HEIGHT);
        this.numObjects = this.GRID_WIDTH * this.GRID_HEIGHT;
        this.springs = new Array(this.GRID_WIDTH * this.GRID_HEIGHT);
        this.movement = false;
        this.steps = 0;
        this.vertex_count = 0;
        this.immobileObjects = [];
    
        this.width = config.sizeX;
        this.height = config.sizeY;
        this.friction = config.friction;
        this.springK = config.springK * 0.5;
        this.mass = 100 - config.mass;
        
        this.initObjects();
        this.initSprings();
    }

    dispose() {
        this.objects = null;
        this.springs = null;
    }

    initObjects() {
        var i = 0, gridY, gridX, gw = this.GRID_WIDTH - 1, gh = this.GRID_HEIGHT - 1;
    
        for (gridY = 0; gridY < this.GRID_HEIGHT; gridY++) {
            for (gridX = 0; gridX < this.GRID_WIDTH; gridX++) {
                this.objects[i++] = new Obj(0, 0, gridX * this.width / gw, gridY * this.height / gh, 0, 0, false);
            }
        }
    }

    initSprings() {
        var i = 0, numSprings = 0, gridY, gridX, hpad = this.width / (this.GRID_WIDTH - 1), vpad = this.height / (this.GRID_HEIGHT - 1);
    
        for (gridY = 0; gridY < this.GRID_HEIGHT; gridY++) {
            for (gridX = 0; gridX < this.GRID_WIDTH; gridX++) {
                if (gridX > 0) {
                    this.springs[numSprings++] = new Spring(this.objects[i - 1], this.objects[i], hpad, 0);
                }
    
                if (gridY > 0) {
                    this.springs[numSprings++] = new Spring(this.objects[i - this.GRID_WIDTH], this.objects[i], 0, vpad);
                }
    
                i++;
            }
        }
    }

    updateObjects() {
        var i = 0, gridY, gridX, gw = this.GRID_WIDTH - 1, gh = this.GRID_HEIGHT - 1;

        for (gridY = 0; gridY < this.GRID_HEIGHT; gridY++) {
            for (gridX = 0; gridX < this.GRID_WIDTH; gridX++) {
                [this.objects[i].x, this.objects[i].y, this.objects[i].velocityX, this.objects[i].velocityY, this.objects[i].forceX, this.objects[i].forceY] = [gridX * this.width / gw, gridY * this.height / gh, 0, 0, 0, 0];
                i++;
            }
        }
    }

    nearestObject(x, y) {
        var dx = 0, dy = 0, distance = 0, minDistance = 0, result = null;

        this.objects.forEach(object => {
            dx = object.x - x;
            dy = object.y - y;
            distance = Math.sqrt(dx * dx + dy * dy);
    
            if (!result || distance < minDistance) {
                minDistance = distance;
                result = object;
            }
        });

        return result;
    }

    grab(x, y) {
        var immobileObject = this.nearestObject(x, y);
        immobileObject.immobile = true;
        this.immobileObjects = [immobileObject];
    }

    maximize() {
        var intensity = 0.8;

        var topLeft = this.nearestObject(0, 0), topRight = this.nearestObject(this.width, 0), bottomLeft = this.nearestObject(0, this.height), bottomRight = this.nearestObject(this.width, this.height);
        [topLeft.immobile, topRight.immobile, bottomLeft.immobile, bottomRight.immobile] = [true, true, true, true];

        this.immobileObjects = [topLeft, topRight, bottomLeft, bottomRight];

        this.friction *= 2;
        if (this.friction > 10) {
            this.friction = 10;
        }

        this.springs.forEach(spring => {
            if (spring.a == topLeft) {
                spring.b.velocityX -= spring.offsetX * intensity;
                spring.b.velocityY -= spring.offsetY * intensity;
            } else if (spring.b == topLeft) {
                spring.a.velocityX -= spring.offsetX * intensity;
                spring.a.velocityY -= spring.offsetY * intensity;
            } else if (spring.a == topRight) {
                spring.b.velocityX -= spring.offsetX * intensity;
                spring.b.velocityY -= spring.offsetY * intensity;
            } else if (spring.b == topRight) {
                spring.a.velocityX -= spring.offsetX * intensity;
                spring.a.velocityY -= spring.offsetY * intensity;
            } else if (spring.a == bottomLeft) {
                spring.b.velocityX -= spring.offsetX * intensity;
                spring.b.velocityY -= spring.offsetY * intensity;
            } else if (spring.b == bottomLeft) {
                spring.a.velocityX -= spring.offsetX * intensity;
                spring.a.velocityY -= spring.offsetY * intensity;
            } else if (spring.a == bottomRight) {
                spring.b.velocityX -= spring.offsetX * intensity;
                spring.b.velocityY -= spring.offsetY * intensity;
            } else if (spring.b == bottomRight) {
                spring.a.velocityX -= spring.offsetX * intensity;
                spring.a.velocityY -= spring.offsetY * intensity;
            }
        });

        this.step(0);
    }

    unmaximize() {
        var intensity = 0.8;

        var immobileObject = this.nearestObject(this.width / 2, this.height / 2);
        immobileObject.immobile = true;
        this.immobileObjects = [immobileObject];

        this.friction *= 2;
        if (this.friction > 10) {
            this.friction = 10;
        }

        this.springs.forEach(spring => {
            if (spring.a == immobileObject) {
                spring.b.velocityX -= spring.offsetX * intensity;
                spring.b.velocityY -= spring.offsetY * intensity;
            } else if (spring.b == immobileObject) {
                spring.a.velocityX -= spring.offsetX * intensity;
                spring.a.velocityY -= spring.offsetY * intensity;
            }
        });
        
        this.step(0);
    }

    step(steps) {
        var movement = false;
        var spring;
        var object;

        for (var j = 0; j <= steps; j++) {
            for (var i = this.springs.length - 1; i >= 0; --i) {
                spring = this.springs[i];
                spring.a.forceX += this.springK * (spring.b.x - spring.a.x - spring.offsetX);
                spring.a.forceY += this.springK * (spring.b.y - spring.a.y - spring.offsetY);
                spring.b.forceX -= this.springK * (spring.b.x - spring.a.x - spring.offsetX);
                spring.b.forceY -= this.springK * (spring.b.y - spring.a.y - spring.offsetY);
            }

            for (var i = this.objects.length - 1; i >= 0; --i) {
                object = this.objects[i];
                if (!object.immobile) {
                    object.forceX -= this.friction * object.velocityX;
                    object.forceY -= this.friction * object.velocityY;
                    object.velocityX += object.forceX / this.mass;
                    object.velocityY += object.forceY / this.mass;
                    object.x += object.velocityX; 
                    object.y += object.velocityY;

                    movement |= Math.abs(object.velocityX) > 5 || Math.abs(object.velocityY) > 5 || Math.abs(object.forceX) > 5 || Math.abs(object.forceY) > 5;
    
                    object.forceX = 0;
                    object.forceY = 0;
                }
            }
        }

        this.movement = movement;
    }

    move(deltaX, deltaY) {
        this.immobileObjects[0].x += deltaX;
        this.immobileObjects[0].y += deltaY;
    }

    resize(sizeX, sizeY) {
        this.width = sizeX;
        this.height = sizeY;

        this.updateObjects();
        this.initSprings();
    }
}