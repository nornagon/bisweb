/*  LICENSE
 
 _This file is Copyright 2018 by the Image Processing and Analysis Group (BioImage Suite Team). Dept. of Radiology & Biomedical Imaging, Yale School of Medicine._
 
 BioImage Suite Web is licensed under the Apache License, Version 2.0 (the "License");
 
 - you may not use this software except in compliance with the License.
 - You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
 
 __Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.__
 
 ENDLICENSE */

"use strict";

const $ = require('jquery');
const Chart = require('chart.js');
const webutil = require('bis_webutil');
const util = require('bis_util');
const fmriutil = require('bis_fmrimatrixconnectivity');
const numeric = require('numeric');
const bisgenericio = require('bis_genericio');
const bootbox = require('bootbox');
const filesaver = require('FileSaver');
const Taucharts = require('taucharts');

//taucharts plugins
require('../../node_modules/taucharts/dist/plugins/tooltip.js');
require('../../node_modules/taucharts/dist/plugins/legend.js');

Chart.defaults.global.defaultFontColor = 'white';
Chart.defaults.global.defaultFontSize = '16';


/**
 * @file Adds a frame to the page that will graph things illuminated by the paint tool. Contains {@link BisWEB_ViewerElements}. 
 * Depends on {@link bisweb_painttoolelement}.
 * @author Zach Saltzman
 * @version 1.0
 */

class GrapherModule extends HTMLElement {
    constructor() {
        super();

        this.lastviewer = null;
        this.desired_width=500;
        this.desired_height=500;
        this.lastdata = null;
        this.graphcanvasid = null;
        this.lastShowVolume=false;
        this.graphWindow=null;
        this.resizingTimer=null;
        this.buttons=[];
        this.extrawidth = 0;
    }

    /** create the GUI (or modifiy it if it exists)
     * @param{Boolean} showbuttons -- if true show the 'Plot VOI Values' and 'Plot VOI Volumes' buttons, else hide them (as we may only have values!)
     */
    createGUI(showbuttons=true) {

        if (this.graphcanvasid!==null) {
            if (this.buttons.length>0) {
                for (let i=0;i<this.buttons.length;i++) {
                    if (showbuttons) 
                        this.buttons[i].css({ "visibility": "visible" });
                    else
                        this.buttons[i].css({ "visibility": "hidden" });
                }
            }
            return;
        }

        this.graphcanvasid = webutil.getuniqueid();
        this.graph = null;
        this.graphWindow = document.createElement('bisweb-dialogelement');                          
        this.graphWindow.create("VOI Tool", this.desired_width, this.desired_height, 20,100,100,false);
        this.graphWindow.widget.css({ "background-color": "#222222" });
        this.graphWindow.setCloseCallback( () => {
            if (this.buttons.length>0) {
                for (let i=0;i<this.buttons.length;i++) {
                    this.buttons[i].css({ "visibility": "hidden" });
                }
            }
            this.graphWindow.hide();
        });

        let bbar=this.graphWindow.getFooter();

        let self = this;
        this.graphWindow.close.remove();
        bbar.empty();
        
        let fn3 = function (e) {
            e.preventDefault();
            self.exportLastData();
        };

        if (showbuttons) {

            this.buttons=[];
            this.buttons.push(webutil.createbutton({
                name: 'Plot VOI Values',
                type: "primary",
                tooltip: '',
                css: {
                    'margin-left': '10px',
                },
                position: "right",
                parent: bbar
            }).click(() => { this.replotGraph(false).catch( () => { } ); }));
            
            this.buttons.push(webutil.createbutton({
                name: 'Plot VOI Volumes',
                type: "default",
                tooltip: '',
                css: {
                    'margin-left': '10px',
                },
                position: "left",
                parent: bbar
            }).click(() => { this.replotGraph(true).catch( () => { } );}));
        }
        
        webutil.createbutton({
            name: 'Export as CSV',
            type: "info",
            tooltip: 'Export Data',
            css: {
                'margin-left': '10px',
            },
            position: "left",
            parent: bbar
        }).click(fn3);

        webutil.createbutton({
            name: 'Save Snapshot',
            type: "warning",
            tooltip: '',
            css: {
                'margin-left': '10px',
            },
            position: "left",
            parent: bbar
        }).click(() => { this.saveSnapshot(); });

        bbar.tooltip();

    }

    /** Main Function 1 as called by the editor tool
     * Graphs the time-averaged mean of fMRI intensity in the area painted by {@link bisweb_painttoolelement} using 
     * {@link bis_fmrimatrixconnectivity.js}. Uses chart.js for the graphics. 
     * Calls plot Graph for the actual plotting.
     * Opening the file tree panel will shrink the canvas, so we need to add the width to the desired size of the graph window to render properly.
     * 
     * @param {HTMLElement} orthoElement - The orthagonal element to take image data from.
     * @param {Number} extraWidth - Extra width to add to the container that will hold the graph. 
     */
    parsePaintedAreaAverageTimeSeries(orthoElement, extraWidth = 0) {

        if (!orthoElement)
            return;

        this.extrawidth = extraWidth; //set the extra width for the graph drawing and future resize events
        this.lastdata = null;
        let image = orthoElement.getimage();
        let objectmap = orthoElement.getobjectmap();

        if (image === null || objectmap === null) {
            webutil.createAlert('No image or objecmap in memory', true);
            return;
        }

        let matrix=null;
        try {
            matrix = fmriutil.roimean(image, objectmap);
        } catch(e) {
            webutil.createAlert('Cannot create roi:'+e, true);
            return;
        }
        
        let y = numeric.transpose(matrix.means);

        let dim = numeric.dim(y);
        let numframes = dim[1];
        let x = null;

        if (numframes > 1) {
            x = numeric.rep([matrix.means.length], 0);
            for (let i = 0; i < matrix.means.length; i++) {
                x[i] = i;
            }
        } else {
            x = numeric.rep([dim[0]], 0);
            for (let i = 0; i < dim[0]; i++) {
                x[i] = i + 1;
            }
        }
        
        this.plotGraph(x, y, matrix.numvoxels, orthoElement);
    }

    /** Main Function 2 plots a Graph directly from data!
     * @param {Array} x - x-axis
     * @param {Array} y - y-axis data (values)
     * @param {Array} numvoxels - y-axis data 2 (optional, these are the "volumes" of ROI if specified)
     * @param {orthoElement} viewer - the viewer to attach to for resizing info (defaults to looking for an ortho-viewer).
     */
    plotGraph(x, y, numvoxels=null,orthoElement=null) {
        
        let changedViewer=false;
        
        if (orthoElement!==this.lastviewer) {
            if (this.lastviewer)
                this.lastviewer.removeResizeObserver(this);
            changedViewer=true;
            this.lastviewer=orthoElement;
        }
        
        this.lastdata = {
            x: x,
            y: y,
            numvoxels: numvoxels
        };

        this.replotGraph(false).then( () => {
            if (changedViewer)
                this.lastviewer.addResizeObserver(this);
        }).catch( (e) => {
            console.log(e,e.stack);
        });

    }

    /** replots the current values
     * @param {Boolean} showVolume -- if true show the volumes (if they exist), else the values
     * @returns {Promise} - when done
     */
    replotGraph(showVolume = false) {

        let showbuttons=true;
        this.lastShowVolume=showVolume;

        if (this.lastdata.numvoxels===null) {
            showVolume=false;
            showbuttons=false;
        }
        
        if (this.lastdata.y < 1) {
            webutil.createAlert('No  objecmap in memory', true);
            return Promise.reject();
        }

        let dim = numeric.dim(this.lastdata.y);
        let numframes = dim[1];
        let data = this.formatChartData(this.lastdata.x,
                                        this.lastdata.y,
                                        this.lastdata.numvoxels,
                                        showVolume);

        let options = null;
        let d_type = '';

        if (numframes > 1 && showVolume === false) {
            options = {
                title: {
                    display: true,
                    text: 'Average Intensity in each Region vs Time'
                },
                elements: {
                    line: {
                        tension: 0, // disables bezier curves
                    }
                },
                scales: {
                    xAxes: [{
                        scaleLabel: {
                            display: true,
                            labelString: 'Time (s)',
                            fontSize: 20
                        }
                    }],
                    yAxes: [{
                        ticks: {
                            beginAtZero: false
                        },
                        scaleLabel: {
                            display: true,
                            labelString: 'Intensity',
                            fontSize: 20
                        }
                    }]
                },
                legend: {
                    position: 'right',
                    display: false
                }
            };
            d_type = 'line';
        } else {
            let heading = "Volume of each Region";
            if (showVolume === false)
                heading = "Average Intensity in each Region";

            options = {
                title: {
                    display: true,
                    text: heading,
                },
                legend: {
                    position: 'right',
                    display: false
                },
                scales: {
                    yAxes: [{
                        scaleLabel: {
                            display: true,
                            labelString: 'Volume (mm^3)',
                            fontSize: 10
                        }
                    }],
                    xAxes: [{
                        scaleLabel: {
                            display: true,
                            labelString: 'Region Index',
                            fontSize: 10
                        }
                    }]
                }
            };
            d_type = 'bar';
        }

        this.createGUI(showbuttons);
        
        
        this.graphWindow.show();
        let dm=this.getCanvasDimensions();
        if (!dm) {
            return Promise.reject("Bad Dimensions");
        }

        console.log('dm', dm);
        let cw=dm[0];
        let ch=dm[1];
        
        let cnv=$(`<div id="${this.graphcanvasid}" class='bisweb-taucharts-container' width="${cw}" height="${ch}" style="overflow: auto"></div>`);
        this.graphWindow.widget.append(cnv);
        cnv.css({
            'position' : 'absolute',
            'left' : '5px',
            'top'  : '8px',
            'margin' : '0 0 0 0',
            'padding' : '0 0 0 0',
            'height' : `${ch}px`,
            'width'  : `${cw}px`,
        });


        let frame = document.getElementById(this.graphcanvasid);

        if (this.graph !== null)
            this.graph.destroy();
        

        return new Promise( (resolve) => {
            setTimeout(() => {
                this.createChart(frame, data);
                /*this.graph = new Chart(canvas, {
                    type: d_type,
                    data: data,
                    options: options
                });*/
                resolve();
            },1);
        });
    }

    /**
     * Reformats the means returned by {@link bis_fmrimatrixconnectivity}.roimean to a format readable by chart.js.
     * Internal use only. 
     * @param{Array} x - x-axis
     * @param{Array} y - y-axis data (values)
     * @param{Array} numVoxels - y-axis data 2 (optional, these are the "volumes" of ROI if specified)
     * @param{Boolean} showVolume - if true then show the second y-axis data (numVoxels) if they exist
     */
    formatChartData(x, y, numVoxels, showVolume) {

        let mx = util.objectmapcolormap.length;
        let dim = numeric.dim(y);
        let numframes = dim[1];
        let labels = [];

        if (numframes > 1 && showVolume === false) {
            let parsedDataSets = [];
            for (let i = 0; i < y.length; i++) {
                if (numVoxels[i] != 0) {
                    let index = i + 1;
                    while (index >= mx) { index = index - mx; }

                    let cl = util.objectmapcolormap[index];
                    cl = 'rgb(' + cl[0] + ', ' + cl[1] + ', ' + cl[2] + ')';

                    parsedDataSets[i] = {
                        label: "Region " + i,
                        data: y[i],
                        backgroundColor: cl,
                        borderColor: cl,
                        borderWidth: 1,
                        pointRadius: 0,
                        fill: false
                    };

                }
            }
            labels = x;
            parsedDataSets = parsedDataSets.filter(Boolean);
            return {
                labels: labels,
                datasets: parsedDataSets
            };
        } else {
            // Bar Chart
            let parsedDataSet = [], data = [], parsedColors = {}, label;
            for (let i = 0; i < y.length; i++) {

                let doshow=false;
                if (numVoxels===null) {
                    doshow=true;
                } else if (numVoxels[i] > 0) {
                    doshow=true;
                }

                if (doshow) {
                    let index = i + 1;
                    let colorindex = index;
                    while (colorindex >= mx) { colorindex = (colorindex - 1) - (mx - 1) + 1; }

                    let cl = util.objectmapcolormap[colorindex];
                    cl = 'rgb(' + cl[0] + ', ' + cl[1] + ', ' + cl[2] + ')';
                    label = 'R' + index;
                    parsedColors[label] = cl;

                    if (showVolume === false)
                        data.push({ 'intensity' : y[i][0], 'index' : index, 'label' : label, 'color' : cl });
                    else
                        data.push({ 'intensity' : numVoxels[i], 'index' : index, 'label' : label, 'color' : cl });
                }
            }

            parsedDataSet.push({
                data: data,
                borderWidth: 1,
                pointRadius: 0
            });

            return {
                colors : parsedColors,
                datasets: parsedDataSet
            };
        }
    }

    createChart(frame, chartData) {

        if (chartData.datasets.length === 1) {
            this.createBarChart(chartData.datasets[0].data, chartData.colors, frame);
        } else {
            this.createLineChart(charData.datasets, chartData.colors, frame);
        }
        
    }


    createBarChart(data, colors, frame) {
        new Taucharts.Chart({
            guide: {
                showAnchors : true,
                x : {
                    padding : 10,
                    label : { text : 'frames' }
                },
                y: {
                    padding: 10,
                    label: { text: 'intensity (pixel value)'},
                },
                color : {
                    brewer : colors
                }
            },
            type: 'bar',
            x: 'index',
            y: 'intensity',
            color: 'label',
            title : 'Intensity by Selected Region',
            settings: {
                fitModel: 'fill-height'
            },
            plugins: [Taucharts.api.plugins.get('tooltip')( {
                fields: ['formula', 'frame', 'intensity', 'type']
            }), Taucharts.api.plugins.get('legend')( {
                'position' : 'top'
            })],
            data: data,
        }).renderTo(frame);
    }

    createLineChart(data, colors, frame) {

    }
    
    show() {
        this.chart.dialog.modal('show');
    }

    /** create a snapshot of the current plot */
    saveSnapshot() {

        let canvas = document.getElementById(this.graphcanvasid);


        let outcanvas = document.createElement('canvas');
        outcanvas.width=canvas.width;
        outcanvas.height=canvas.height;

        let ctx = outcanvas.getContext('2d');
        ctx.fillStyle = "#555555";
        ctx.globalCompositeOperation = "source-over";
        ctx.fillRect(0, 0, outcanvas.width, outcanvas.height);
        ctx.drawImage(canvas, 0, 0, outcanvas.width, outcanvas.height);

        let outimg = outcanvas.toDataURL("image/png");        
        
        let dispimg = $('<img id="dynamic">');
        dispimg.attr('src', outimg);
        dispimg.width(300);

        let a = webutil.creatediv();
        a.append(dispimg);

        bootbox.dialog({
            title: 'This is the snapshot (size=' + canvas.width + 'x' + canvas.height + ').<BR> Click SAVE to output as png.',
            message: a.html(),
            buttons: {
                ok: {
                    label: "Save To File",
                    className: "btn-success",
                    callback: function () {
                        let blob = bisgenericio.dataURLToBlob(outimg);
                        if (webutil.inElectronApp()) {
                            let reader = new FileReader();
                            reader.onload = function () {
                                let buf = this.result;
                                let arr = new Int8Array(buf);
                                bisgenericio.write({
                                    filename: "snapshot.png",
                                    title: 'Select file to save snapshot in',
                                    filters: [{ name: 'PNG Files', extensions: ['png'] }],
                                }, arr, true);
                            };
                            reader.readAsArrayBuffer(blob);
                        } else {
                            filesaver(blob, 'snapshot.png');
                        }
                    }
                },
                cancel: {
                    label: "Cancel",
                    className: "btn-danger",
                },
            }
        });
        return false;
    }

    /** save the last data to csv */
    exportLastData() {

        if (this.lastdata === null)
            return;

        let dim = numeric.dim(this.lastdata.y);
        let numrows = dim[1];
        let numcols = dim[0];

        let out = " ,";
        for (let pass = 0; pass <= 2; pass++) {

            if (pass == 1)
                out += "Volume,";
            if (pass == 2)
                out += "\nFrame,";

            for (let col = 0; col < numcols; col++) {
                if (this.lastdata.numvoxels[col]>0) {
                    if (pass === 0 || pass === 2)
                        out += `Region ${col + 1}`;
                    else
                        out += `${this.lastdata.numvoxels[col]}`;
                    if (col < numcols - 1)
                        out += ',';
                }
            }
            out += "\n";
        }


        for (let row = 0; row < numrows; row++) {
            let line = `${this.lastdata.x[row]}, `;
            for (let col = 0; col < numcols; col++) {
                if (this.lastdata.numvoxels[col]>0) {
                    line += `${this.lastdata.y[col][row]}`;
                    if (col < numcols - 1)
                        line += ',';
                }
            }
            out += line + '\n';
        }



        bisgenericio.write({
            filename: 'voidata.csv',
            title: 'Select file to save void timeseries as ',
            filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        }, out);

        return false;
    }

    /**
     * handles resize event from viewer
     * @param {array} dim - [ width,height] of viewer
     */
    handleresize() {

        if (this.resizingTimer) {
            clearTimeout(this.resizingTimer);
            this.resizingTimer=null;
        }

        if (this.graphWindow===null) {
            return;
        }

        if (!this.graphWindow.isVisible()) {
            this.getCanvasDimensions();
            return;
        }


        const self=this;
        this.resizingTimer=setTimeout( () => {
            self.replotGraph(self.lastShowVolume).catch( (e) => {
                console.log(e,e.stack);
            });
        },200);
        
    }


    /** Resizes elements and returns the canvas dimensions. Adds file tree panel width if necessary
     * @returns {array} - [ canvaswidth,canvasheight ]
     */
    getCanvasDimensions() {

        let dim=[200,200];
        
        if (this.lastviewer) {
            dim=this.lastviewer.getViewerDimensions();
        } else if (dim===null) {
            dim=[ window.innerWidth,window.innerHeight ];
        }

        dim[0] += this.extrawidth;

        let width=dim[0]-20;
        let height=dim[1]-20;
        let left=10;
        let top=40;

        this.graphWindow.dialog.css({
            'left': `${left}px`,
            'width' :`${width}px`,
            'top' : `${top}px`,
            'height' : `${height}px`,
        });

        let innerh=height-120;
        let innerw=width-10;
        this.graphWindow.widget.css({
            'margin' : '0 0 0 0',
            'padding' : '0 0 0 0',
            'height' : `${innerh}px`,
            'width'  : `${innerw}px`,
            "overflow-y": "hidden",
            "overflow-x": "hidden" ,
        });
        this.graphWindow.widgetbase.css({
            'height' : `${innerh}px`,
            'width'  : `${innerw}px`,
            'background-color' : '#222222',
            'margin' : '0 0 0 0',
            'padding' : '0 0 0 0',
            "overflow-y": "hidden",
            "overflow-x": "hidden" ,
        });

        this.graphWindow.footer.css({
            "height" : "40px",
            'margin' : '3 3 3 3',
            'padding' : '0 0 0 0',
            "overflow-y": "hidden",
            "overflow-x": "hidden" ,
        });

        this.graphWindow.widget.empty();
        return [ innerw, innerh-15 ];
    }

}

module.exports=GrapherModule;
webutil.defineElement('bisweb-graphelement', GrapherModule);


