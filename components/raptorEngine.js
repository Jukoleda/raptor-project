




function RaptorEngine() {
    this.context = undefined;
    this.createWindow = () => {
        var gameWindow = document.createElement("canvas");

        gameWindow.id = "gameWindow";
        gameWindow.width = 800;
        gameWindow.height = 600;

        document.body.appendChild(gameWindow);

        var context = gameWindow.getContext("webgl");

        if (!context) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
        }

        this.context = context;
    };

    this.drawClearColor = () => {
        this.context.clearColor(0.0, 0.0, 0.0, 1.0);
        this.context.clearDepth(1.0);
        this.context.enable(this.context.DEPTH_TEST);
        this.context.depthFunc(this.context.LEQUAL);
    };

    this.clearScreen = () => {
        this.context.clear(this.context.COLOR_BUFFER_BIT | this.context.DEPTH_BUFFER_BIT);
    };

    this.draw = () => {
        this.drawClearColor();
        this.clearScreen();

        var cuadrado = new Square(0,0,0,0, this.context);
        cuadrado.init();
        cuadrado.draw();
    };

   

};

function Square(x, y, w, h, context) {

    this.context = context;
    this.programInfo = {};

    this.vsSource = `
        attribute vec4 aVertexPosition;

        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;

        void main() {
        gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
        }
    `;

    this.fsSource = `
        void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        }
    `;

    this.initShaderProgram = () => {
        const vertexShader = this.loadShader(this.context.VERTEX_SHADER, this.vsSource);
        const fragmentShader = this.loadShader(this.context.FRAGMENT_SHADER, this.fsSource);

        const shaderProgram = this.context.createProgram();
        this.context.attachShader(shaderProgram, vertexShader);
        this.context.attachShader(shaderProgram, fragmentShader);
        this.context.linkProgram(shaderProgram);

        if (!this.context.getProgramParameter(shaderProgram, this.context.LINK_STATUS)) {
            alert("Unable to initialize the shader program: " + this.context.getProgramInfoLog(shaderProgram));
        }

        this.shaderProgram = shaderProgram;
    }

    this.initBuffers = () => {
        const positionBuffer = this.context.createBuffer();

        this.context.bindBuffer(this.context.ARRAY_BUFFER, positionBuffer);

        const positions = [1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, -1.0];

        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(positions), this.context.STATIC_DRAW);
    }

    this.loadShader = (type, source) => {
        const shader = this.context.createShader(type);

        this.context.shaderSource(shader, source);
      
        this.context.compileShader(shader);
      
        if (!this.context.getShaderParameter(shader, this.context.COMPILE_STATUS)) {
          alert(
            "An error occurred compiling the shaders: " + this.context.getShaderInfoLog(shader)
          );
          this.context.deleteShader(shader);
          return null;
        }
      
        return shader;
    }

    this.generateProgramInfo = () => {

        this.programInfo = {
            program: this.shaderProgram,
            attribLocations: {
                vertexPosition: this.context.getAttribLocation(this.shaderProgram, "aVertexPosition"),
            },
            uniformLocations: {
                projectionMatrix: this.context.getUniformLocation(this.shaderProgram, "uProjectionMatrix"),
                modelViewMatrix: this.context.getUniformLocation(this.shaderProgram, "uModelViewMatrix"),
            },
        };

    }

    this.init = () => {
        this.initShaderProgram();
        this.generateProgramInfo();
        this.initBuffers();
    }

    this.draw = () => {
        const fieldOfView = (45 * Math.PI) / 180; // in radians
        const aspect = this.context.canvas.clientWidth / this.context.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 100.0;
        const projectionMatrix = mat4.create();

        mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);

        const modelViewMatrix = mat4.create();
      
        mat4.translate(
          modelViewMatrix, // destination matrix
          modelViewMatrix, // matrix to translate
          [-0.0, 0.0, -6.0]
        ); // amount to translate
      
        {
          const numComponents = 2;
          const type = this.context.FLOAT;
          const normalize = false;
          const stride = 0;
          const offset = 0;
          this.context.vertexAttribPointer(
            this.programInfo.attribLocations.vertexPosition,
            numComponents,
            type,
            normalize,
            stride,
            offset
          );
          this.context.enableVertexAttribArray(this.programInfo.attribLocations.vertexPosition);
        }
      
        this.context.useProgram(this.programInfo.program);
      
        this.context.uniformMatrix4fv(
          this.programInfo.uniformLocations.projectionMatrix,
          false,
          projectionMatrix
        );
        this.context.uniformMatrix4fv(
          this.programInfo.uniformLocations.modelViewMatrix,
          false,
          modelViewMatrix
        );
      
        {
          const offset = 0;
          const vertexCount = 4;
          this.context.drawArrays(this.context.TRIANGLE_STRIP, offset, vertexCount);
        }
    }

}

export default RaptorEngine;