/**
 * Fluid WebGL фон для hero variant B и auth-страницы.
 */
(function () {
  'use strict';

  var CONFIG = {
    renderScale: 0.30,
    maxFPS: 30,
    speed: 0.13,
    fadeIn: 2.5,
    intensity: 1.0,
    gapAmount: 0.55,
    breathe: 1.0
  };

  var rafId = 0;
  var running = false;
  var gl = null;
  var canvas = null;
  var drawFn = null;
  var onVisChange = null;
  var onResize = null;

  function destroy() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (onVisChange) {
      document.removeEventListener('visibilitychange', onVisChange);
      onVisChange = null;
    }
    if (onResize) {
      window.removeEventListener('resize', onResize);
      onResize = null;
    }
    drawFn = null;
    gl = null;
    canvas = null;
  }

  function initOn(canvasId, bgSelector) {
    destroy();
    canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var bg = bgSelector ? document.querySelector(bgSelector) : null;
    if (canvas.offsetParent === null && canvasId !== 'auth-wave') return;

    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power'
    });

    if (!gl) {
      if (bg) {
        bg.style.background =
          'radial-gradient(ellipse at 50% 120%,#4b3fa6,#1a1640 45%,#06081c 80%)';
      }
      return;
    }

    var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
    var FRAG = [
      'precision mediump float;uniform vec2 uRes;uniform float uTime;uniform float uFade;uniform float uIntensity;uniform float uGap;uniform float uBreathe;',
      'float hash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+34.45);return fract(p.x*p.y);}',
      'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
      'float fbm(vec2 p){float v=0.0;v+=0.50*noise(p);p*=2.07;v+=0.25*noise(p);p*=2.13;v+=0.125*noise(p);return v*1.143;}',
      'void main(){vec2 uv=gl_FragCoord.xy/uRes;float aspect=uRes.x/uRes.y;float t=uTime;',
      'float cx=uv.x-0.5;float edge=0.30+1.05*cx*cx;',
      'edge+=(fbm(vec2(uv.x*2.2*aspect+t*0.7,t*0.45))-0.5)*0.28;',
      'edge+=sin(uv.x*3.5*aspect-t*1.4)*0.025;',
      'float d=edge-uv.y;',
      'vec2 q=vec2(uv.x*2.6*aspect,d*2.6);',
      'vec2 warp=vec2(fbm(q*1.2+vec2(t*0.95,-t*0.6)),fbm(q*1.2+vec2(-t*0.7,t*0.85)+5.2));',
      'float flow=fbm(q+2.6*(warp-0.5)+vec2(t*0.45,0.0));',
      'float width=1.6+uBreathe*3.0*fbm(vec2(uv.x*1.3*aspect-t*0.55,t*0.3));',
      'float crest=smoothstep(0.0,0.03+0.05*flow,d);',
      'float fall=exp(-max(d,0.0)*width);',
      'float gate=smoothstep(0.30,0.62,flow);',
      'float gaps=mix(1.0,gate,uGap+0.35*uGap*sin(t*0.9+uv.x*6.0));',
      'float fil=0.5+0.5*sin(d*24.0+(warp.x-0.5)*10.0+uv.x*5.0*aspect-t*1.2);',
      'float sideMask=smoothstep(0.02,0.16,cx*cx);',
      'float ribbons=mix(1.0,0.30+0.70*fil,sideMask*0.85);',
      'float body=crest*(0.15+1.15*fall)*gaps*ribbons*(0.35+0.95*flow);',
      'float haze=crest*exp(-max(d,0.0)*1.4)*0.16;',
      'float vein=fbm(vec2(uv.x*5.0*aspect-t*0.9,d*6.0+t*0.4));',
      'float streak=smoothstep(0.09,0.0,abs(d-0.035-0.05*vein))*crest*(0.4+0.6*gate);',
      'vec3 purple=vec3(0.42,0.30,0.92);vec3 blue=vec3(0.22,0.42,1.00);vec3 cyan=vec3(0.25,0.90,0.85);vec3 pink=vec3(0.92,0.42,0.95);vec3 deep=vec3(0.10,0.09,0.30);',
      'vec3 col=mix(purple,blue,smoothstep(0.25,0.75,flow));',
      'col=mix(col,cyan,smoothstep(0.62,0.92,flow)*0.85);',
      'col=col*body+deep*haze+pink*streak*(0.35+0.45*flow);',
      'col*=mix(0.35,1.0,exp(-max(d-0.05,0.0)*2.0));',
      'col*=uIntensity*uFade;',
      'col+=(hash(gl_FragCoord.xy+fract(t))-0.5)*0.012;',
      'gl_FragColor=vec4(col,1.0);}'
    ].join('\n');

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'uRes');
    var uTime = gl.getUniformLocation(prog, 'uTime');
    var uFade = gl.getUniformLocation(prog, 'uFade');
    gl.uniform1f(gl.getUniformLocation(prog, 'uIntensity'), CONFIG.intensity);
    gl.uniform1f(gl.getUniformLocation(prog, 'uGap'), CONFIG.gapAmount);
    gl.uniform1f(gl.getUniformLocation(prog, 'uBreathe'), CONFIG.breathe);

    function resize() {
      if (!canvas || !gl) return;
      var w = Math.max(2, Math.round(canvas.clientWidth * CONFIG.renderScale));
      var h = Math.max(2, Math.round(canvas.clientHeight * CONFIG.renderScale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uRes, w, h);
      }
    }

    onResize = function () { resize(); };
    resize();
    window.addEventListener('resize', onResize);

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var start = performance.now();
    var lastFrame = 0;
    var frameInterval = 1000 / CONFIG.maxFPS;
    running = true;

    drawFn = function (now) {
      if (!running) return;
      rafId = requestAnimationFrame(drawFn);
      if (now - lastFrame < frameInterval) return;
      lastFrame = now;
      var elapsed = (now - start) / 1000;
      var fade = Math.min(elapsed / CONFIG.fadeIn, 1.0);
      fade = fade * fade * (3.0 - 2.0 * fade);
      gl.uniform1f(uTime, elapsed * CONFIG.speed);
      gl.uniform1f(uFade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (reduced) {
      gl.uniform1f(uTime, 7.3);
      gl.uniform1f(uFade, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      rafId = requestAnimationFrame(drawFn);
      onVisChange = function () {
        running = !document.hidden;
        if (running) {
          lastFrame = 0;
          rafId = requestAnimationFrame(drawFn);
        }
      };
      document.addEventListener('visibilitychange', onVisChange);
    }
  }

  window.HeroWave = {
    init: function () { initOn('wave', '#hero-variant-b .hero-bg'); },
    initAuth: function () { initOn('auth-wave', '.auth-bg'); },
    destroy: destroy
  };
})();
