import * as vscode from 'vscode';
import * as path from 'path';
import {AnalysisResult} from './reactAnalyzer';

export class VisualizerPanel {
  public static currentPanel : VisualizerPanel | undefined;
  private readonly _panel : vscode.WebviewPanel;
  private _disposables : vscode.Disposable[] = [];
  private _webviewReady : boolean = false;
  private _pendingMessage : any = null;

  constructor(private readonly _extensionUri : vscode.Uri) {
    this._panel = vscode
      .window
      .createWebviewPanel('reactVisualizer', 'React Component Visualizer', vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [
          vscode
            .Uri
            .joinPath(this._extensionUri, 'media'),
          this._extensionUri
        ],
        retainContextWhenHidden: true
      });

    console.log('Webview panel created');

    this
      ._panel
      .onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this
      ._panel
      .webview
      .onDidReceiveMessage(message => {
        console.log('Message received from webview:', message);
        switch (message.command) {
          case 'openFile':
            this._openFile(message.filePath);
            break;
          case 'showError':
            vscode
              .window
              .showErrorMessage(message.text);
            break;
          case 'showInfo':
            vscode
              .window
              .showInformationMessage(message.text);
            break;
          case 'webviewReady':
            console.log('Webview signaled it is ready');
            this._webviewReady = true;
            // Send any pending message
            if (this._pendingMessage) {
              console.log('Sending pending message to now-ready webview');
              this
                ._panel
                .webview
                .postMessage(this._pendingMessage);
              this._pendingMessage = null;
            }
            break;
        }
      }, null, this._disposables);

    // Set HTML content AFTER setting up message handler
    console.log('Setting webview HTML...');
    this._panel.webview.html = this._getHtmlForWebview();
    console.log('Webview HTML set');
  }

  public reveal() {
    this
      ._panel
      .reveal();
  }

  public updateVisualization(data : AnalysisResult) {
    // Serialize data to ensure it's JSON-safe (no circular references, functions,
    // etc.)
    let serializedData;
    try {
      serializedData = JSON.parse(JSON.stringify(data));
    } catch (error) {
      vscode
        .window
        .showErrorMessage('Failed to serialize visualization data');
      return;
    }

    const message = {
      command: 'updateData',
      data: serializedData
    };

    // Try multiple times with delays to ensure webview is ready
    const attemptSend = (attempt : number = 0) => {
      try {
        console.log(`Attempt ${attempt + 1} to send message...`);
        this
          ._panel
          .webview
          .postMessage(message)
          .then((success) => {
            console.log('Message sent successfully, received:', success);
          }, (error) => {
            console.error('Message send failed:', error);
            if (attempt < 5) {
              console.log('Retrying in 500ms...');
              setTimeout(() => attemptSend(attempt + 1), 500);
            }
          });
      } catch (error) {
        console.error('Error posting message:', error);
        if (attempt < 5) {
          console.log('Retrying in 500ms...');
          setTimeout(() => attemptSend(attempt + 1), 500);
        }
      }
    };

    attemptSend();
  }

  public onDidDispose(callback : () => void) {
    this
      ._panel
      .onDidDispose(callback);
  }

  public dispose() {
    VisualizerPanel.currentPanel = undefined;
    this
      ._panel
      .dispose();

    while (this._disposables.length) {
      const disposable = this
        ._disposables
        .pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _openFile(filePath : string) {
    const uri = vscode
      .Uri
      .file(filePath);
    vscode
      .window
      .showTextDocument(uri);
  }

  private _getHtmlForWebview() : string {
    const webview = this._panel.webview;

    // Try to get local D3, fallback to CDN
    const localD3Path = vscode
      .Uri
      .joinPath(this._extensionUri, 'media', 'd3.min.js');
    const scriptUri = webview.asWebviewUri(localD3Path);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} https://cdnjs.cloudflare.com 'unsafe-inline' 'unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline';">
    <title>React Component Visualizer</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #1f2937;
            color: #f9fafb;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            height: 100vh;
        }

        .container {
          display: grid;
          width: 100%;
          height: 100%;
          grid-template-rows: 4.5rem 1fr;
          grid-template-columns: 1fr 200px;
        }

        .visualization-area {
            flex: 1;
            position: relative;
        }

        .visualization-area > .svg {
          display: block;
          width: max-width;
          height: max-height;
          overflow: auto;
        }

        .header {
            padding: 16px;
            background: #374151;
            border-bottom: 1px solid #4b5563;
        }

        .header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .header p {
            margin: 4px 0 0 0;
            font-size: 12px;
            color: #9ca3af;
        }

        .sidebar {
            width: 300px;
            background: #374151;
            border-left: 1px solid #4b5563;
            padding: 16px;
            overflow-y: auto;
        }

        .sidebar h3 {
            margin: 0 0 12px 0;
            font-size: 14px;
            font-weight: 600;
        }

        .flow-item {
            padding: 8px;
            margin: 8px 0;
            background: #4b5563;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .flow-item:hover {
            background: #6b7280;
        }

        .flow-item.selected {
            background: #3b82f6;
        }

        .flow-header {
            display: flex;
            items: center;
            margin-bottom: 4px;
        }

        .flow-color {
            width: 12px;
            height: 12px;
            border-radius: 2px;
            margin-right: 8px;
        }

        .flow-name {
            font-size: 12px;
            font-weight: 500;
        }

        .flow-description {
            font-size: 10px;
            color: #d1d5db;
            margin-left: 20px;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            font-size: 16px;
            color: #9ca3af;
        }

        .error {
            color: #ef4444;
            padding: 16px;
            text-align: center;
        }

        svg {
            width: 100%;
            height: 100%;
        }

        .legend {
            border-top: 1px solid #4b5563;
            padding-top: 16px;
            margin-top: 16px;
        }

        .legend-item {
            display: flex;
            align-items: center;
            margin: 4px 0;
            font-size: 12px;
        }

        .legend-color {
            width: 8px;
            height: 8px;
            border-radius: 2px;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="visualization-area">
            <div class="header">
                <h2>React Component Visualizer</h2>
                <p>Interactive diagram showing component relationships, state flow, and context</p>
            </div>
            <div id="loading" class="loading">
                Analyzing React components...
            </div>
            <div id="error" class="error" style="display: none;"></div>
            <svg id="visualization" style="display: none;"></svg>
        </div>
        
        <div class="sidebar">
            <div id="debug-info" style="margin-bottom: 20px; padding: 12px; background: #4b5563; border-radius: 4px; font-family: monospace; font-size: 10px;">
                <h3 style="margin: 0 0 8px 0; color: #fbbf24;">Debug Info</h3>
                <div id="debug-content">Waiting for analysis...</div>
            </div>
            
            <div>
                <h3>Data Flows</h3>
                <div id="flows-list"></div>
            </div>
            
            <div style="margin-top: 20px;">
                <h3>Conflicts & Overlaps</h3>
                <div id="conflicts-list"></div>
            </div>

            <div class="legend">
                <h3>Legend</h3>
                <div class="legend-item">
                    <div class="legend-color" style="background: #22c55e;"></div>
                    <span>State Variables</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #10b981;"></div>
                    <span>State Setters</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #f59e0b;"></div>
                    <span>Props</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #3b82f6;"></div>
                    <span>Functions</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #8b5cf6;"></div>
                    <span>Context</span>
                </div>
            </div>

            <div style="margin-top: 20px; border-top: 1px solid #4b5563; padding-top: 16px;">
                <h3>Instructions</h3>
                <ul style="font-size: 12px; color: #d1d5db; padding-left: 16px;">
                    <li>Click components to view details</li>
                    <li>Hover connections to highlight</li>
                    <li>Select flows to trace data paths</li>
                    <li>Red borders indicate conflicts</li>
                </ul>
            </div>
        </div>
    </div>

    <script src="${scriptUri}" onerror="loadD3FromCDN()"></script>
    <script>
        (function() {
            'use strict';
            
            // Immediate test
            document.getElementById('loading').innerHTML = 'JavaScript is running...';
            
            // Global error handler
            window.onerror = function(message, source, lineno, colno, error) {
                console.error('Global error:', message, 'at', source, lineno, colno);
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').innerHTML = '<h3>JavaScript Error</h3><p>' + message + '</p><p>Line: ' + lineno + '</p>';
                return true;
            };

            console.log('Script started');

            // Fallback to CDN if local D3 fails to load
            function loadD3FromCDN() {
            console.log('Loading D3 from CDN...');
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js';
            script.onload = function() {
                console.log('D3 loaded from CDN successfully');
                initializeApp();
            };
            script.onerror = function() {
                console.error('Failed to load D3 from CDN');
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').innerHTML = '<h3>Failed to load D3.js</h3><p>Cannot initialize visualization.</p>';
            };
            document.head.appendChild(script);
        }

        // Check if D3 loaded
        console.log('Checking for D3... typeof d3:', typeof d3);
        if (typeof d3 === 'undefined') {
            console.warn('D3 not loaded, attempting CDN fallback...');
            loadD3FromCDN();
        } else {
            console.log('D3 loaded successfully');
            initializeApp();
        }

        function initializeApp() {
            if (typeof d3 === 'undefined') {
                console.error('D3 is still not available');
                return;
            }

        const vscode = acquireVsCodeApi();
        
        let currentData = null;
        let selectedFlow = null;
        let svg = null;

        // Initialize visualization
        function initializeVisualization() {
            svg = d3.select('#visualization');
            
            const vizArea = document.querySelector('.visualization-area');
            const width = vizArea.clientWidth;
            const height = vizArea.clientHeight - 60;

            svg.attr('width', width)
               .attr('height', height)
               .attr('viewBox', '0 0 ' + width + ' ' + height)
               .style('background', '#1f2937');

            // Create grid pattern
            const defs = svg.append('defs');
            const pattern = defs.append('pattern')
                .attr('id', 'grid')
                .attr('width', 20)
                .attr('height', 20)
                .attr('patternUnits', 'userSpaceOnUse');

            pattern.append('path')
                .attr('d', 'M 20 0 L 0 0 0 20')
                .attr('fill', 'none')
                .attr('stroke', '#374151')
                .attr('stroke-width', 0.5);

            svg.append('rect')
                .attr('width', '100%')
                .attr('height', '100%')
                .attr('fill', 'url(#grid)');
        }

        // Update visualization with new data
        function updateVisualization(data) {
            console.log('updateVisualization called with:', data);
            
            currentData = data;
            
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'none';
            document.getElementById('visualization').style.display = 'block';

            console.log('Display states updated, checking data...');

            // Update debug info
            if (data.debug) {
                console.log('Updating debug info...');
                const debugContent = document.getElementById('debug-content');
                const logEntries = data.debug.analysisLog.slice(-10).map(log => 
                    '<div style="color: #d1d5db;">' + log + '</div>'
                ).join('');
                
                debugContent.innerHTML = 
                    '<div style="color: #10b981;">✓ Files: ' + data.debug.filesAnalyzed.length + '</div>' +
                    '<div style="color: #10b981;">✓ Components: ' + data.debug.componentsFound.length + '</div>' +
                    '<div style="color: #ef4444;">✗ Errors: ' + data.debug.parseErrors.length + '</div>' +
                    '<div style="margin-top: 8px; max-height: 100px; overflow-y: auto;">' + logEntries + '</div>';
                
                // Log to browser console for detailed debugging
                console.log('Debug Info:', data.debug);
            }

            if (!svg) {
                console.log('Initializing SVG...');
                initializeVisualization();
            }

            if (!data.components || data.components.length === 0) {
                console.log('No components found, showing error');
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').innerHTML = 
                    '<h3>No Components Found</h3>' +
                    '<p>Check the debug info above for details.</p>' +
                    '<p>Common issues:</p>' +
                    '<ul style="text-align: left; display: inline-block;">' +
                        '<li>Component names must start with uppercase</li>' +
                        '<li>Components must return JSX</li>' +
                        '<li>Check console for parse errors</li>' +
                    '</ul>';
                return;
            }

            console.log('Rendering components:', data.components.length);
            renderComponents(data.components);
            
            console.log('Rendering flows:', data.flows.length);
            renderFlows(data.flows);
            
            console.log('Updating sidebar...');
            updateSidebar(data);
            
            console.log('Visualization complete!');
        }

        function renderComponents(components) {
            svg.selectAll('.component').remove();

            const componentGroup = svg.append('g').attr('class', 'components');

            components.forEach(function(component) {
                const group = componentGroup.append('g')
                    .attr('class', 'component')
                    .attr('transform', 'translate(' + component.x + ',' + component.y + ')')
                    .style('cursor', 'pointer')
                    .on('click', function() {
                        vscode.postMessage({
                            command: 'openFile',
                            filePath: component.filePath
                        });
                    });

                // Component container
                group.append('rect')
                    .attr('width', component.width)
                    .attr('height', component.height)
                    .attr('rx', 8)
                    .attr('ry', 8)
                    .attr('fill', 'none')
                    .attr('stroke', '#6b7280')
                    .attr('stroke-width', 2)
                    .on('mouseenter', function() {
                        d3.select(this).attr('stroke', '#3b82f6').attr('stroke-width', 3);
                    })
                    .on('mouseleave', function() {
                        d3.select(this).attr('stroke', '#6b7280').attr('stroke-width', 2);
                    });

                // Component title
                group.append('text')
                    .attr('x', component.width / 2)
                    .attr('y', 20)
                    .attr('text-anchor', 'middle')
                    .attr('fill', '#f9fafb')
                    .attr('font-size', '14px')
                    .attr('font-weight', 'bold')
                    .text(component.name);

                // Component items
                component.items.forEach(function(item, index) {
                    const itemY = 40 + (index * 18);
                    
                    const isHighlighted = selectedFlow && item.flowId === selectedFlow;
                    
                    // Item background
                    group.append('rect')
                        .attr('x', 8)
                        .attr('y', itemY - 12)
                        .attr('width', component.width - 16)
                        .attr('height', 16)
                        .attr('rx', 2)
                        .attr('fill', item.color)
                        .attr('opacity', isHighlighted ? 0.4 : 0.2)
                        .attr('stroke', isHighlighted ? item.color : 'none')
                        .attr('stroke-width', isHighlighted ? 1 : 0);

                    // Connection point
                    const isInput = item.type === 'prop' || item.type === 'prop-function' || item.type === 'context-consumer';
                    const connectionX = isInput ? 0 : component.width;
                    const isContext = item.type.includes('context');
                    
                    if (isContext) {
                        group.append('rect')
                            .attr('x', connectionX - 2)
                            .attr('y', itemY - 2)
                            .attr('width', 4)
                            .attr('height', 4)
                            .attr('fill', item.color)
                            .attr('stroke', '#1f2937')
                            .attr('stroke-width', 1);
                    } else {
                        group.append('circle')
                            .attr('cx', connectionX)
                            .attr('cy', itemY)
                            .attr('r', 3)
                            .attr('fill', item.color)
                            .attr('stroke', '#1f2937')
                            .attr('stroke-width', 1);
                    }

                    // Item text
                    group.append('text')
                        .attr('x', 12)
                        .attr('y', itemY)
                        .attr('fill', item.color)
                        .attr('font-size', '11px')
                        .attr('font-family', 'monospace')
                        .attr('font-weight', isHighlighted ? 'bold' : 'normal')
                        .text(item.name);

                    // Type indicator
                    group.append('text')
                        .attr('x', component.width - 12)
                        .attr('y', itemY)
                        .attr('text-anchor', 'end')
                        .attr('fill', item.color)
                        .attr('font-size', '9px')
                        .attr('opacity', 0.7)
                        .text(item.type);
                });
            });
        }

        function renderFlows(flows) {
            if (!currentData) return;

            svg.selectAll('.flows').remove();
            const flowGroup = svg.append('g').attr('class', 'flows');

            // Add arrowhead marker
            svg.select('defs').append('marker')
                .attr('id', 'arrowhead')
                .attr('viewBox', '-0 -5 10 10')
                .attr('refX', 8)
                .attr('refY', 0)
                .attr('orient', 'auto')
                .attr('markerWidth', 6)
                .attr('markerHeight', 6)
                .append('path')
                .attr('d', 'M 0,-5 L 10,0 L 0,5')
                .attr('fill', '#6b7280');

            const flowColors = {
                'user-flow': '#3b82f6',
                'theme-flow': '#8b5cf6',
                'loading-flow': '#06b6d4',
                'login-flow': '#f59e0b',
                'profile-flow': '#10b981',
                'editing-flow': '#ef4444',
                'auth-context': '#8b5cf6',
                'theme-context': '#ec4899'
            };

            flows.forEach(function(flow) {
                const fromComponent = currentData.components.find(function(c) {
                    return c.items.some(function(item) { return item.id === flow.fromItem; });
                });
                const toComponent = currentData.components.find(function(c) {
                    return c.items.some(function(item) { return item.id === flow.toItem; });
                });

                if (fromComponent && toComponent) {
                    const fromItem = fromComponent.items.find(function(item) { return item.id === flow.fromItem; });
                    const toItem = toComponent.items.find(function(item) { return item.id === flow.toItem; });
                    
                    if (fromItem && toItem) {
                        const fromItemIndex = fromComponent.items.indexOf(fromItem);
                        const toItemIndex = toComponent.items.indexOf(toItem);
                        
                        const fromPos = {
                            x: fromComponent.x + fromComponent.width,
                            y: fromComponent.y + 40 + (fromItemIndex * 18)
                        };
                        
                        const toPos = {
                            x: toComponent.x,
                            y: toComponent.y + 40 + (toItemIndex * 18)
                        };

                        const color = flowColors[flow.id] || '#6b7280';
                        const isContextFlow = flow.type === 'context-provider-to-consumer';
                        
                        flowGroup.append('path')
                            .attr('d', 'M ' + fromPos.x + ' ' + fromPos.y + 
                                     ' C ' + (fromPos.x + 40) + ' ' + fromPos.y + 
                                     ' ' + (toPos.x - 40) + ' ' + toPos.y + 
                                     ' ' + toPos.x + ' ' + toPos.y)
                            .attr('fill', 'none')
                            .attr('stroke', color)
                            .attr('stroke-width', 2)
                            .attr('stroke-dasharray', isContextFlow ? '8,4' : 'none')
                            .attr('opacity', selectedFlow && selectedFlow !== flow.id ? 0.2 : 0.7)
                            .attr('marker-end', 'url(#arrowhead)')
                            .style('cursor', 'pointer')
                            .on('click', function() { selectFlow(flow.id); });
                    }
                }
            });
        }

        function updateSidebar(data) {
            const flowsList = document.getElementById('flows-list');
            const conflictsList = document.getElementById('conflicts-list');

            // Update flows
            const flowDescriptions = {
                'user-flow': 'User state flows through multiple components',
                'theme-flow': 'Theme configuration cascades down',
                'loading-flow': 'Loading state from App to Header',
                'login-flow': 'Login handler passed as prop',
                'profile-flow': 'Profile data managed in UserProfile',
                'editing-flow': 'Edit mode controlled by UserProfile',
                'auth-context': 'Authentication context from App',
                'theme-context': 'Theme context for styling'
            };

            const uniqueFlows = [...new Set(data.flows.map(f => f.id))];
            
            flowsList.innerHTML = uniqueFlows.map(function(flowId) {
                return '<div class="flow-item ' + (selectedFlow === flowId ? 'selected' : '') + '" onclick="selectFlow(&quot;' + flowId + '&quot;)">' +
                    '<div class="flow-header">' +
                        '<div class="flow-color" style="background: ' + getFlowColor(flowId) + ';"></div>' +
                        '<div class="flow-name">' + flowId + '</div>' +
                    '</div>' +
                    '<div class="flow-description">' + (flowDescriptions[flowId] || 'Data flow connection') + '</div>' +
                '</div>';
            }).join('');

            // Update conflicts
            if (data.conflicts && data.conflicts.length > 0) {
                conflictsList.innerHTML = data.conflicts.map(function(conflict) {
                    return '<div style="background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 4px; padding: 8px; margin: 8px 0;">' +
                        '<div style="color: #fca5a5; font-size: 12px; font-weight: 500;">' + conflict.id + '</div>' +
                        '<div style="color: #fecaca; font-size: 10px; margin-top: 4px;">' + conflict.description + '</div>' +
                        '<div style="color: #fca5a5; font-size: 10px; margin-top: 4px;">' + conflict.items.length + ' items involved</div>' +
                    '</div>';
                }).join('');
            } else {
                conflictsList.innerHTML = '<div style="color: #9ca3af; font-size: 12px; text-align: center;">No conflicts detected</div>';
            }
        }

        function selectFlow(flowId) {
            selectedFlow = selectedFlow === flowId ? null : flowId;
            if (currentData) {
                renderComponents(currentData.components);
                renderFlows(currentData.flows);
                updateSidebar(currentData);
            }
        }

        function getFlowColor(flowId) {
            const colors = {
                'user-flow': '#3b82f6',
                'theme-flow': '#8b5cf6',
                'loading-flow': '#06b6d4',
                'login-flow': '#f59e0b',
                'profile-flow': '#10b981',
                'editing-flow': '#ef4444',
                'auth-context': '#8b5cf6',
                'theme-context': '#ec4899'
            };
            return colors[flowId] || '#6b7280';
        }

        // Handle messages from extension
        window.addEventListener('message', function(event) {
            const message = event.data;
            
            console.log('Webview received message:', message.command);
            
            switch (message.command) {
                case 'updateData':
                    console.log('Received data:', message.data);
                    updateVisualization(message.data);
                    break;
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (svg && currentData) {
                const width = document.querySelector('.visualization-area').clientWidth;
                const height = document.querySelector('.visualization-area').clientHeight - 60;
                svg.attr('width', width).attr('height', height);
            }
        });

        // Show initial loading state
        vscode.postMessage({
            command: 'webviewReady',
            text: 'React Visualizer ready!'
        });
        
        console.log('Webview initialized and ready to receive data');
        }})(); // end IIFE
    </script>
</body>
</html>`;
  }
}