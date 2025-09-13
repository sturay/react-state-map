import * as vscode from 'vscode';
import * as path from 'path';
import {AnalysisResult} from './reactAnalyzer';

export class VisualizerPanel {
  public static currentPanel : VisualizerPanel | undefined;
  private readonly _panel : vscode.WebviewPanel;
  private _disposables : vscode.Disposable[] = [];

  constructor(private readonly _extensionUri : vscode.Uri) {
    this._panel = vscode
      .window
      .createWebviewPanel('reactVisualizer', 'React Component Visualizer', vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
        retainContextWhenHidden: true
      });

    this._panel.webview.html = this._getHtmlForWebview();

    this
      ._panel
      .onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this
      ._panel
      .webview
      .onDidReceiveMessage(message => {
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
        }
      }, null, this._disposables);
  }

  public reveal() {
    this
      ._panel
      .reveal();
  }

  public updateVisualization(data : AnalysisResult) {
    this
      ._panel
      .webview
      .postMessage({command: 'updateData', data: data});
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

    // Get URIs for resources
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'd3.min.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            display: flex;
            width: 100%;
            height: 100%;
        }

        .visualization-area {
            flex: 1;
            position: relative;
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

    <script src="${scriptUri}"></script>
    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = null;
        let selectedFlow = null;
        let svg = null;

        // Initialize visualization
        function initializeVisualization() {
            svg = d3.select('#visualization');
            
            const width = document.querySelector('.visualization-area').clientWidth;
            const height = document.querySelector('.visualization-area').clientHeight - 60; // Account for header

            svg.attr('width', width)
               .attr('height', height)
               .attr('viewBox', \`0 0 \${width} \${height}\`)
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
            currentData = data;
            
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'none';
            document.getElementById('visualization').style.display = 'block';

            if (!svg) {
                initializeVisualization();
            }

            renderComponents(data.components);
            renderFlows(data.flows);
            updateSidebar(data);
        }

        function renderComponents(components) {
            svg.selectAll('.component').remove();

            const componentGroup = svg.append('g').attr('class', 'components');

            components.forEach(component => {
                const group = componentGroup.append('g')
                    .attr('class', 'component')
                    .attr('transform', \`translate(\${component.x}, \${component.y})\`)
                    .style('cursor', 'pointer')
                    .on('click', () => {
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
                component.items.forEach((item, index) => {
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

            flows.forEach(flow => {
                const fromComponent = currentData.components.find(c => 
                    c.items.some(item => item.id === flow.fromItem));
                const toComponent = currentData.components.find(c => 
                    c.items.some(item => item.id === flow.toItem));

                if (fromComponent && toComponent) {
                    const fromItem = fromComponent.items.find(item => item.id === flow.fromItem);
                    const toItem = toComponent.items.find(item => item.id === flow.toItem);
                    
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
                            .attr('d', \`M \${fromPos.x} \${fromPos.y} 
                                       C \${fromPos.x + 40} \${fromPos.y} 
                                         \${toPos.x - 40} \${toPos.y} 
                                         \${toPos.x} \${toPos.y}\`)
                            .attr('fill', 'none')
                            .attr('stroke', color)
                            .attr('stroke-width', 2)
                            .attr('stroke-dasharray', isContextFlow ? '8,4' : 'none')
                            .attr('opacity', selectedFlow && selectedFlow !== flow.id ? 0.2 : 0.7)
                            .attr('marker-end', 'url(#arrowhead)')
                            .style('cursor', 'pointer')
                            .on('click', () => selectFlow(flow.id));
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
            
            flowsList.innerHTML = uniqueFlows.map(flowId => \`
                <div class="flow-item \${selectedFlow === flowId ? 'selected' : ''}" onclick="selectFlow('\${flowId}')">
                    <div class="flow-header">
                        <div class="flow-color" style="background: \${getFlowColor(flowId)};"></div>
                        <div class="flow-name">\${flowId}</div>
                    </div>
                    <div class="flow-description">\${flowDescriptions[flowId] || 'Data flow connection'}</div>
                </div>
            \`).join('');

            // Update conflicts
            if (data.conflicts && data.conflicts.length > 0) {
                conflictsList.innerHTML = data.conflicts.map(conflict => \`
                    <div style="background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 4px; padding: 8px; margin: 8px 0;">
                        <div style="color: #fca5a5; font-size: 12px; font-weight: 500;">\${conflict.id}</div>
                        <div style="color: #fecaca; font-size: 10px; margin-top: 4px;">\${conflict.description}</div>
                        <div style="color: #fca5a5; font-size: 10px; margin-top: 4px;">\${conflict.items.length} items involved</div>
                    </div>
                \`).join('');
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
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'updateData':
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
            command: 'showInfo',
            text: 'React Visualizer ready!'
        });
    </script>
</body>
</html>`;
  }
}