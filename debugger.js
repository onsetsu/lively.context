editor = ace.edit('editor-debugger');
editor.getSession().setMode('ace/mode/javascript');
editor.renderer.setShowPrintMargin(false);

// configure debugger environment
editor.on('changeMode', function(e) {
    this.session.$worker.call('changeOptions', [{ debug: true }]);
}.bind(editor));
editor.getSession().on('change', function(e) {
    reset('debugger');
});
example_error('debugger');

function reset() {
    resetVariables();
    removeException();
    removeCustomMarkers();
    addVariable(null, 'not run yet');
}

function setExampleCode(src) {
    editor.setValue(src, 1);
    editor.session.clearBreakpoints();
    resetVariables();
    addVariable(null, 'not run yet');
}
function example_sumLoop() {
    setExampleCode(
        'var array = [0, 1, 2, 3, 4, 5],\n' +
        '    sum = 0;\n' +
        '\n' +
        'for (var i = 0; i < array.length; i++)\n' +
        '  sum += array[i];'
    );
}

function example_sumReduce() {
    setExampleCode(
        'var array = [0, 1, 2, 3, 4, 5];\n' +
        'var sum = array.reduce(function(acc,  n) {\n' +
        '  return acc + n;\n' +
        '});'
    );
}

function example_fibonacci() {
    setExampleCode(
        'function fibo(n) {\n' +
        '  if (n <= 1)\n' +
        '    return n;\n' +
        '  return fibo(n - 1) + fibo(n - 2);\n' +
        '}\n' +
        '\n' +
        'var fib6 = fibo(6);'
    );
}

function example_square() {
    setExampleCode(
        'var a = 1;\n' +
        'var b = 2;\n' +
        '\n'+
        'function square(a) {\n' +
        '  var sq = a * a;\n' +
        '  return sq;\n' +
        '}\n' +
        '\n' +
        'var s = square(b);'
    );
}

function example_error() {
    setExampleCode(
        'var x = 1;\n' +
        'for (var i = 0; i < 5; i++) {\n' +
        '  y += 1; // y is not defined => Error here\n' +
        '  if (i == 3)\n' +
        '    debugger;\n' +
        '  x += i;\n' +
        '}'
    );
}

function findStatementAtLine(ast, line) {
    var maxLines = ast.loc.end.line,
        res;

    do {
        res = lively.ast.acorn.walk.findNodeAt(ast, null, null, function(type, node) {
            return node.loc.start.line === line;
        });
        line += 1;
    } while ((res == undefined) && (line <= maxLines));

    return res && lively.ast.acorn.walk.findStatementOfNode(ast, res.node);
}

function step(env, stopAtRow) {
    if (!editor) return;

    resetVariables();

    var src = editor.getValue(),
        ast = lively.ast.parse(src, { sourceType: 'script', locations: true }),
        breakPoint = editor.session.getBreakpoints().indexOf('ace_breakpoint'),
        scope = { mapping: {} },
        interpreter = new lively.ast.AcornInterpreter.Interpreter();

    if (breakPoint > -1) {
        var node = findStatementAtLine(ast, breakPoint + 1);
        if (node) {
            node.isBreakpoint = true;

            // patch function
            interpreter.shouldHaltAtNextStatement = function(node) {
                return !!node.isBreakpoint;
            };
        }
    }

    var program = new lively.ast.AcornInterpreter.Function(ast),
        frame = lively.ast.AcornInterpreter.Frame.create(program, scope.mapping);
    program.lexicalScope = frame.getScope();

    try {
        interpreter.runWithFrameAndResult(ast, frame, undefined);
    } catch (e) {
        if (e.isUnwindException) // an UnwindException is thrown for the breakpoints (or errors)
            scope = e.top.getScope();
    }

    displayScope(scope);
}

function run() {
    if (!editor) return;

    displayAST();

    resetVariables();
    removeException();

    var srcPrefix = '(function() {',
        srcPostfix = ' });',
        src = srcPrefix + editor.getValue() + srcPostfix,
        func = eval(src),
        runtime, scope, ex, frame;

    try {
        runtime = lively.ast.StackReification.run(func);
        scope = runtime.currentFrame.getScope();
        if (runtime.isContinuation)
            frame = runtime.currentFrame;
    } catch(e) {
        if (e.unwindException) { // might have been an UnwindException originally
            ex = e.unwindException;
            ex.recreateFrames();
            frame = ex.top;
            scope = ex.top.getScope();
        }
    }
    if (scope) {
        displayScope(scope);
        if (frame)
            setException(frame, srcPrefix.length, ex);
    } else {
        setVariable(null, 'no exception triggered');
    }
}

function setException(frame, offset, err) {
    if (isNaN(offset)) offset = 0;

    var ex = document.getElementById('exception-debugger');
    if (!ex) return;
    ex.style.setProperty('display', 'block');
    if (err)
        ex.innerHTML = '<strong>' + err.error.name + ':</strong> ' + err.error.message;
    else
        ex.innerHTML = '<strong>Stopped execution:</strong> Debugger statement';

    var aceRange = ace.require('ace/range').Range,
        node;
    do {
        node = frame.getPC();
        var start = editor.session.doc.indexToPosition(node.start - offset - 1),
            end = editor.session.doc.indexToPosition(node.end - offset - 1);
        ex.innerHTML += '<br>&nbsp;&nbsp;&nbsp;&nbsp;at: ' + node.type + ' @ line ' + (start.row + 1) + ', column ' + start.column;
        var marker = editor.session.addMarker(new aceRange(start.row, start.column, end.row, end.column), 'programCounter', 'text', false);
        frame = frame.parentFrame;
    } while (frame);
}

function removeException() {
    var ex = document.getElementById('exception-debugger');
    if (ex)
        ex.style.setProperty('display', 'none');
}

function removeCustomMarkers() {
    var markers = editor.session.getMarkers();
    Object.getOwnPropertyNames(markers).forEach(function(markerId) {
        if (markers[markerId].clazz == 'programCounter')
            editor.session.removeMarker(markerId);
    });
}

function getVarList() {
    var list = document.getElementById('vars-debugger');
    if (!list) return null;
    list = list.getElementsByClassName('varList')[0];
    return list;
}

function resetVariables() {
    var varList = getVarList();
    if (!varList) return;
    Array.from(varList.children).forEach(function(child) {
        child.remove();
    });
}

function displayScope(scope) {
    do {
        var mapping = scope.mapping;
        Object.getOwnPropertyNames(mapping).forEach(function(varName) {
            setVariable(varName, mapping[varName]);
        });
        scope = scope.parentScope;
    } while (scope != null && scope.mapping != window);
}

function setVariable(varName, varValue) {
    var varList = getVarList();
    if (!varList) return;

    var allVars = Array.from(varList.getElementsByTagName('dt')).map(function(elem) {
        return elem.textContent;
    });

    if (allVars.indexOf(varName) == -1)
        addVariable(varName, varValue);
}

function addVariable(varName, varValue) {
    var varList = getVarList();
    if (!varList) return;

    var elem;
    if (varName != null) {
        elem = document.createElement('dt');
        elem.textContent = varName;
        varList.appendChild(elem);
    }
    elem = document.createElement('dd');
    strValue = String(varValue);
    var isFunc = strValue.match(/function\s+(.*)\s*\{/)
    if (isFunc) {
        strValue = isFunc[0] + ' ... }';
    }
    elem.textContent = strValue;
    varList.appendChild(elem);
}

var width = 960,
    height = 500;

var tree = d3.layout.tree()
    .size([height, width]);

var svg = d3.select(".content").append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g");
    //.attr("transform", "translate(" + margin.left + "," + margin.top + ")");

var diagonal = d3.svg.diagonal()
    .projection(function(d) { return [d.y, d.x]; });

function displayAST() {
    // clear current visualization
    svg.selectAll("g.node").remove();
    svg.selectAll("path.link").remove();

    var src = editor.getValue(),
        ast = lively.ast.parse(src, { sourceType: 'script', locations: true });
    var data = ast;

    var mapToChildren = new Map();
    estraverse.traverse(data, {
        enter: function (node, parent) {
            if(parent && node) {
                if(mapToChildren.has(parent)) {
                    mapToChildren.get(parent).push(node);
                } else {
                    mapToChildren.set(parent, [node]);
                }
            }
        }
    });

    tree.children(function(d) {
        if(mapToChildren.has(d)) {
            return mapToChildren.get(d);
        }
        return null;
    });

    // Compute the new tree layout.
    var nodes = tree.nodes(data).reverse(),
        links = tree.links(nodes);

    // Declare the nodes�
    var node = svg.selectAll("g.node")
        .data(nodes);

    // Enter the nodes.
    var nodeEnter = node.enter().append("g")
        .attr("class", "node")
        .attr("transform", function(d) {
            return "translate(" + d.y + "," + d.x + ")";
        })
        .on('mouseover', d => {
            var node = d;
            var aceRange = ace.require('ace/range').Range;
            var start = editor.session.doc.indexToPosition(node.start),
                end = editor.session.doc.indexToPosition(node.end);
            window.ACEmarker = editor.session.addMarker(new aceRange(start.row, start.column, end.row, end.column), 'programCounter', 'text', false);
        })
        .on('mouseout', d => {
            editor.session.removeMarker(window.ACEmarker);
        });

    nodeEnter.append("circle")
        .attr("r", 10)
        .style("fill", "#fff");

    nodeEnter.append("text")
        .attr("x", function(d) {
            return d.children || d._children ? -13 : 13; })
        .attr("dy", ".35em")
        .attr("text-anchor", function(d) {
            return d.children || d._children ? "end" : "start"; })
        .text(function(d) { return d.type; })
        .style("fill-opacity", 1);

    // Declare the links�
    var link = svg.selectAll("path.link")
        .data(links);

    // Enter the links.
    link.enter().insert("path", "g")
        .attr("class", "link")
        .attr("d", diagonal);
}