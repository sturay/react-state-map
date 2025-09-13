import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

export interface ComponentData {
    id: string;
    filePath: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    items: ComponentItem[];
}

export interface ComponentItem {
    id: string;
    name: string;
    type: 'state' | 'setter' | 'prop' | 'prop-function' | 'function' | 'context-provider' | 'context-consumer';
    color: string;
    flowId: string;
}

export interface DataFlow {
    id: string;
    fromItem: string;
    toItem: string;
    type: string;
}

export interface ConflictData {
    id: string;
    description: string;
    items: string[];
}

export interface AnalysisResult {
    components: ComponentData[];
    flows: DataFlow[];
    conflicts: ConflictData[];
}

export class ReactAnalyzer {
    private readonly STATE_HOOKS = ['useState', 'useReducer'];
    private readonly CONTEXT_HOOKS = ['useContext'];
    private readonly CONTEXT_PROVIDERS = ['Provider'];

    async analyzeReactProject(projectPath: string): Promise<AnalysisResult> {
        const reactFiles = await this.findReactFiles(projectPath);
        const components: ComponentData[] = [];
        const flows: DataFlow[] = [];
        const conflicts: ConflictData[] = [];

        for (const filePath of reactFiles) {
            try {
                const fileComponents = await this.analyzeFile(filePath);
                components.push(...fileComponents);
            } catch (error) {
                console.error(`Error analyzing ${filePath}:`, error);
            }
        }

        // Analyze relationships between components
        const analysisData = this.analyzeRelationships(components);
        
        return {
            components: this.layoutComponents(components),
            flows: analysisData.flows,
            conflicts: analysisData.conflicts
        };
    }

    private async findReactFiles(projectPath: string): Promise<string[]> {
        const reactFiles: string[] = [];
        
        const scanDirectory = (dirPath: string) => {
            if (dirPath.includes('node_modules')) return;
            
            const items = fs.readdirSync(dirPath);
            
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    scanDirectory(fullPath);
                } else if (/\.(jsx?|tsx?)$/.test(item)) {
                    reactFiles.push(fullPath);
                }
            }
        };

        if (fs.statSync(projectPath).isFile()) {
            reactFiles.push(projectPath);
        } else {
            scanDirectory(projectPath);
        }

        return reactFiles;
    }

    private async analyzeFile(filePath: string): Promise<ComponentData[]> {
        const code = fs.readFileSync(filePath, 'utf-8');
        const components: ComponentData[] = [];

        try {
            const ast = parse(code, {
                sourceType: 'module',
                plugins: [
                    'jsx',
                    'typescript',
                    'decorators-legacy',
                    'classProperties'
                ]
            });

            traverse(ast, {
                // Function components
                FunctionDeclaration: (path) => {
                    if (this.isReactComponent(path.node)) {
                        const component = this.analyzeComponent(path.node, filePath);
                        if (component) components.push(component);
                    }
                },

                // Arrow function components
                VariableDeclarator: (path) => {
                    if (t.isArrowFunctionExpression(path.node.init) || 
                        t.isFunctionExpression(path.node.init)) {
                        if (this.isReactComponent(path.node.init)) {
                            const component = this.analyzeComponent(path.node, filePath);
                            if (component) components.push(component);
                        }
                    }
                },

                // Class components
                ClassDeclaration: (path) => {
                    if (this.isReactClassComponent(path.node)) {
                        const component = this.analyzeClassComponent(path.node, filePath);
                        if (component) components.push(component);
                    }
                }
            });

        } catch (error) {
            console.error(`Error parsing ${filePath}:`, error);
        }

        return components;
    }

    private isReactComponent(node: any): boolean {
        // Check if function returns JSX
        let hasJSX = false;
        
        const checkForJSX = (node: any) => {
            if (t.isJSXElement(node) || t.isJSXFragment(node)) {
                hasJSX = true;
                return;
            }
            
            if (t.isReturnStatement(node) && node.argument) {
                if (t.isJSXElement(node.argument) || t.isJSXFragment(node.argument)) {
                    hasJSX = true;
                }
            }
        };

        traverse(node, {
            enter(path) {
                checkForJSX(path.node);
            }
        });

        return hasJSX;
    }

    private isReactClassComponent(node: t.ClassDeclaration): boolean {
        return !!(node.superClass && 
                 t.isMemberExpression(node.superClass) &&
                 t.isIdentifier(node.superClass.property) &&
                 node.superClass.property.name === 'Component');
    }

    private analyzeComponent(node: any, filePath: string): ComponentData | null {
        const componentName = this.getComponentName(node);
        if (!componentName) return null;

        const items: ComponentItem[] = [];
        let itemCounter = 0;

        // Analyze the component body for hooks, props, etc.
        traverse(node, {
            CallExpression: (path) => {
                const callee = path.node.callee;
                
                if (t.isIdentifier(callee)) {
                    // useState hook
                    if (this.STATE_HOOKS.includes(callee.name)) {
                        const parent = path.parent;
                        if (t.isVariableDeclarator(parent) && t.isArrayPattern(parent.id)) {
                            const elements = parent.id.elements;
                            if (elements.length >= 2) {
                                const stateName = t.isIdentifier(elements[0]) ? elements[0].name : `state${itemCounter++}`;
                                const setterName = t.isIdentifier(elements[1]) ? elements[1].name : `setter${itemCounter++}`;
                                
                                items.push({
                                    id: `${componentName}-${stateName}`,
                                    name: stateName,
                                    type: 'state',
                                    color: '#22c55e',
                                    flowId: `${stateName}-flow`
                                });

                                items.push({
                                    id: `${componentName}-${setterName}`,
                                    name: setterName,
                                    type: 'setter',
                                    color: '#10b981',
                                    flowId: `${stateName}-flow`
                                });
                            }
                        }
                    }

                    // useContext hook
                    if (this.CONTEXT_HOOKS.includes(callee.name)) {
                        const parent = path.parent;
                        if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                            items.push({
                                id: `${componentName}-${parent.id.name}`,
                                name: `${parent.id.name}()`,
                                type: 'context-consumer',
                                color: '#8b5cf6',
                                flowId: `${parent.id.name}-context`
                            });
                        }
                    }
                }

                // Context Provider detection
                if (t.isMemberExpression(callee) && 
                    t.isIdentifier(callee.property) && 
                    callee.property.name === 'Provider') {
                    const contextName = t.isIdentifier(callee.object) ? callee.object.name : 'Context';
                    items.push({
                        id: `${componentName}-${contextName}Provider`,
                        name: `${contextName}Provider`,
                        type: 'context-provider',
                        color: '#ec4899',
                        flowId: `${contextName}-context`
                    });
                }
            },

            // Function declarations within component
            FunctionDeclaration: (path) => {
                if (path.node.id) {
                    items.push({
                        id: `${componentName}-${path.node.id.name}`,
                        name: path.node.id.name,
                        type: 'function',
                        color: '#3b82f6',
                        flowId: `${path.node.id.name}-flow`
                    });
                }
            },

            // Arrow functions assigned to variables
            VariableDeclarator: (path) => {
                if (t.isArrowFunctionExpression(path.node.init) && 
                    t.isIdentifier(path.node.id)) {
                    items.push({
                        id: `${componentName}-${path.node.id.name}`,
                        name: path.node.id.name,
                        type: 'function',
                        color: '#3b82f6',
                        flowId: `${path.node.id.name}-flow`
                    });
                }
            }
        });

        // Analyze props (this would require more sophisticated analysis)
        const props = this.extractProps(node);
        items.push(...props.map(prop => ({
            id: `${componentName}-${prop}`,
            name: prop,
            type: 'prop' as const,
            color: '#f59e0b',
            flowId: `${prop}-flow`
        })));

        return {
            id: componentName,
            filePath,
            name: componentName,
            x: 0, // Will be set in layoutComponents
            y: 0,
            width: Math.max(200, componentName.length * 8 + 40),
            height: Math.max(100, items.length * 18 + 60),
            items
        };
    }

    private analyzeClassComponent(node: t.ClassDeclaration, filePath: string): ComponentData | null {
        const componentName = node.id?.name;
        if (!componentName) return null;

        const items: ComponentItem[] = [];

        // Analyze class methods and state
        traverse(node, {
            ClassMethod: (path) => {
                if (t.isIdentifier(path.node.key)) {
                    const methodName = path.node.key.name;
                    if (methodName !== 'render' && methodName !== 'constructor') {
                        items.push({
                            id: `${componentName}-${methodName}`,
                            name: methodName,
                            type: 'function',
                            color: '#3b82f6',
                            flowId: `${methodName}-flow`
                        });
                    }
                }
            },

            // Look for this.state assignments
            MemberExpression: (path) => {
                if (t.isThisExpression(path.node.object) && 
                    t.isIdentifier(path.node.property) && 
                    path.node.property.name === 'state') {
                    // This would need more analysis to extract state properties
                }
            }
        });

        return {
            id: componentName,
            filePath,
            name: componentName,
            x: 0,
            y: 0,
            width: Math.max(200, componentName.length * 8 + 40),
            height: Math.max(100, items.length * 18 + 60),
            items
        };
    }

    private getComponentName(node: any): string | null {
        if (t.isFunctionDeclaration(node) && node.id) {
            return node.id.name;
        }
        
        if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
            return node.id.name;
        }

        if (t.isClassDeclaration(node) && node.id) {
            return node.id.name;
        }

        return null;
    }

    private extractProps(node: any): string[] {
        const props: string[] = [];
        
        // Look for destructured props in function parameters
        traverse(node, {
            ObjectPattern: (path) => {
                if (path.parent && (t.isFunction(path.parent) || t.isArrowFunctionExpression(path.parent))) {
                    path.node.properties.forEach(prop => {
                        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                            props.push(prop.key.name);
                        }
                    });
                }
            },

            // Look for props.something usage
            MemberExpression: (path) => {
                if (t.isIdentifier(path.node.object) && 
                    path.node.object.name === 'props' &&
                    t.isIdentifier(path.node.property)) {
                    if (!props.includes(path.node.property.name)) {
                        props.push(path.node.property.name);
                    }
                }
            }
        });

        return props;
    }

    private analyzeRelationships(components: ComponentData[]): { flows: DataFlow[], conflicts: ConflictData[] } {
        const flows: DataFlow[] = [];
        const conflicts: ConflictData[] = [];

        // This would need more sophisticated analysis to detect actual prop passing
        // and context usage relationships between components
        
        // For now, return empty arrays - in a real implementation, you'd:
        // 1. Analyze import/export relationships
        // 2. Track JSX usage to see which components render which others
        // 3. Match prop names between parent and child components
        // 4. Detect context provider/consumer relationships

        return { flows, conflicts };
    }

    private layoutComponents(components: ComponentData[]): ComponentData[] {
        // Simple grid layout - in a real implementation, you'd use a more sophisticated
        // graph layout algorithm like Dagre or force-directed layout
        
        const cols = Math.ceil(Math.sqrt(components.length));
        const spacing = 50;
        
        return components.map((component, index) => ({
            ...component,
            x: (index % cols) * (component.width + spacing) + 50,
            y: Math.floor(index / cols) * (component.height + spacing) + 50
        }));
    }
}