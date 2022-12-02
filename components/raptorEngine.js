




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
        requestAnimationFrame(this.drawClearColor);

    };

    this.clearScreen = () => {
        this.context.clear(this.context.COLOR_BUFFER_BIT | this.context.DEPTH_BUFFER_BIT);
        requestAnimationFrame(this.clearScreen);

    };

    this.draw = () => {
        this.drawClearColor();
        this.clearScreen();

        var cuadrado = new Square(this.context);
        cuadrado.setColor({red:0.5});
        cuadrado.init();
        cuadrado.rotation = 45;
        cuadrado.setScale({x: 0.5, y: 0.5})
        cuadrado.draw();
        
        // requestAnimationFrame(this.drawClearColor);
        // requestAnimationFrame(this.clearScreen);
        // requestAnimationFrame(cuadrado.draw);
    };

   

};

function Square(context) {

    this.context = context;
    this.programInfo = undefined;
    this.rotation = 0.0;
    this.then = 0;
    this.color = undefined;
    this.scale = undefined;
    
   


    this.vsSource = `
        attribute vec4 aVertexPosition;
        attribute vec4 aVertexColor;

        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;

        varying lowp vec4 vColor;

        void main() {

            gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
            vColor = aVertexColor;
        }
    `;

    this.fsSource = `
        varying lowp vec4 vColor;    

        void main() {
            gl_FragColor = vColor;
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

        const programInfo = {
            ...this.programInfo,
            program: shaderProgram
        }

        this.programInfo = programInfo;
    }

    this.initBuffers = () => {

        const positionBuffer = this.context.createBuffer();

        this.context.bindBuffer(this.context.ARRAY_BUFFER, positionBuffer);

        const positions = [
            1.0, 1.0, 
            -1.0, 1.0, 
            1.0, -1.0, 
            -1.0, -1.0,
        ];

        this.vCount = positions.length / 2;

        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(positions), this.context.STATIC_DRAW);


        const colorBuffer = this.context.createBuffer();

        this.context.bindBuffer(this.context.ARRAY_BUFFER, colorBuffer);

        
        if (this.color === undefined) {
            this.setColor({red: 1, green: 1, blue: 1, alpha: 1});
        }

        var colors = [ this.color.red, this.color.green, this.color.blue, this.color.alpha,
                        this.color.red, this.color.green, this.color.blue, this.color.alpha,
                        this.color.red, this.color.green, this.color.blue, this.color.alpha,
                        this.color.red, this.color.green, this.color.blue, this.color.alpha,
                    ];
        // var colors = [ 1.0, 1.0, 1.0, 1.0, // white
        //                 1.0, 0.0, 0.0, 1.0, // red
        //                 0.0, 1.0, 0.0, 1.0, // green
        //                 0.0, 0.0, 1.0, 1.0, // blue
        //             ];

        this.context.bufferData(this.context.ARRAY_BUFFER, new Float32Array(colors), this.context.STATIC_DRAW);
        
        const programInfo = {
            ...this.programInfo,
            buffers: {
                color: colorBuffer,
                position: positionBuffer
            }
        }

        this.programInfo = programInfo;

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
                vertexColor: this.context.getAttribLocation(this.shaderProgram, "aVertexColor"),
            },
            uniformLocations: {
                projectionMatrix: this.context.getUniformLocation(this.shaderProgram, "uProjectionMatrix"),
                modelViewMatrix: this.context.getUniformLocation(this.shaderProgram, "uModelViewMatrix"),
                scaleMatrix: this.context.getUniformLocation(this.shaderProgram, "uScale"),
            },
        };

    }

    this.init = () => {
        this.initShaderProgram();
        this.generateProgramInfo();
        this.initBuffers();
    }

    this.draw = (now) => {

        // now *= 0.001;
        // const deltaTime = now - this.then;
        // this.then = now;

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
          [-0.0, 0.0, -5.0]
        ); // amount to translate

        mat4.rotate(
            modelViewMatrix,
            modelViewMatrix,
            (this.rotation * Math.PI) / -180,
            [0, 0, 1]
        );


        if (this.scale == undefined) {
            this.setScale({x: 1, y: 1});
        }
        mat4.scale(
            modelViewMatrix,
            modelViewMatrix,
            [this.scale.x, this.scale.y, 1]
        );
      
        {
          const numComponents = 2;
          const type = this.context.FLOAT;
          const normalize = false;
          const stride = 0;
          const offset = 0;
          this.context.bindBuffer(this.context.ARRAY_BUFFER, this.programInfo.buffers.position);
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

        {
            const numComponents = 4;
            const type = this.context.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            this.context.bindBuffer(this.context.ARRAY_BUFFER, this.programInfo.buffers.color);
            this.context.vertexAttribPointer(
              this.programInfo.attribLocations.vertexColor,
              numComponents,
              type,
              normalize,
              stride,
              offset
            );
            this.context.enableVertexAttribArray(this.programInfo.attribLocations.vertexColor);
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
        //   const vertexCount = 7;
          this.context.drawArrays(this.context.TRIANGLE_STRIP, offset, this.vCount);
        }

        // this.rotation += deltaTime;


        requestAnimationFrame(this.draw);
    }

    this.setColor = ({red, green, blue, alpha}) => {
        this.color = {red: red ?? 0.0 , green: green ?? 0.0 , blue: blue ?? 0.0 , alpha: alpha ?? 1.0 };
    }
    this.setScale = ({x, y}) => {
        this.scale = {x: x ?? 1.0 , y: y ?? 1.0};
    }

}

export default RaptorEngine;