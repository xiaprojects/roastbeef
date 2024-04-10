/*
    Copyright (c) 2023 XIAPROJECTS SRL
    Distributable under the terms of The "BSD New" License
    that can be found in the LICENSE file, herein included
    as part of this header.

    cockpit_widgets.js
    
    Features:
    - HSI
    - Variometer
    - Altimeter
    - IAS
    - Gyro
*/



/**
 * 
 * @param {*} div 
 * @param {*} item 
 */
function HSICircleRenderer(div, item) {
    var hsiSettings = {
        "middleCircleSize": 5,
        "middleCircleDistance": 25,
        "horizontalLine": { "w": 10, "h": 100, "color": "orange" },
        "h": 140
    };

    var image = SVG(div).viewbox(-hsiSettings.h, -hsiSettings.h, 2 * hsiSettings.h, 2 * hsiSettings.h);


    /*****************/
    var slopeTextLeft = image.text("GS").style('font-size', '10px');
    slopeTextLeft.cx(-hsiSettings.h + 8);
    slopeTextLeft.cy(-hsiSettings.middleCircleDistance * 4 - 10);
    var slopeLeft = image.polygon('0,0 -5,5 -5,10 5,10 5,5 0,0 -5,-5 -5,-10 5,-10 5,-5');
    slopeLeft.style("fill", hsiSettings.horizontalLine.color);
    slopeLeft.cx(-hsiSettings.h + 8);
    slopeLeft.cy(0);
    /*****************/
    var slopeTextRight = image.text("GS").style('font-size', '10px');
    slopeTextRight.cx(+hsiSettings.h - 8);
    slopeTextRight.cy(-hsiSettings.middleCircleDistance * 4 - 10);
    var slopeRight = image.polygon('0,0 -5,5 -5,10 5,10 5,5 0,0 -5,-5 -5,-10 5,-10 5,-5');
    slopeRight.style("fill", hsiSettings.horizontalLine.color);
    slopeRight.cx(hsiSettings.h - 8);
    slopeRight.cy(0);

    for (var hsiIndex = -4; hsiIndex < 5; hsiIndex++) {
        var cl = image.circle(hsiSettings.middleCircleSize);
        cl.cx(-hsiSettings.h + 8).cy(hsiSettings.middleCircleDistance * hsiIndex);
        var cr = image.circle(hsiSettings.middleCircleSize);
        cr.cx(hsiSettings.h - 8).cy(hsiSettings.middleCircleDistance * hsiIndex);

        if (hsiIndex == 0) {
            cl.style('fill', "red");
            cr.style('fill', "red");
        }
    }
    /*****************/
    var containerOuter = image.group();
    containerOuter.text("N").style('font-size', '32px').style("fill", "#ff0000").style("stroke", "#ff0000")
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2);
    containerOuter.text("E").style('font-size', '32px')//.style("fill", "#000000")
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2)
        .transform({ rotation: 90, cx: 0, cy: 0, relative: false });
    containerOuter.text("S").style('font-size', '32px')//.style("fill", "#000000")
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2)
        .transform({ rotation: 180, cx: 0, cy: 0, relative: false });
    containerOuter.text("W").style('font-size', '32px')//.style("fill", "#000000")
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.2)
        .transform({ rotation: 270, cx: 0, cy: 0, relative: false });

    containerOuter.text("3").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 30, cx: 0, cy: 0, relative: false });
    containerOuter.text("6").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 60, cx: 0, cy: 0, relative: false });
    containerOuter.text("12").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 120, cx: 0, cy: 0, relative: false });
    containerOuter.text("15").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 150, cx: 0, cy: 0, relative: false });
    containerOuter.text("21").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 210, cx: 0, cy: 0, relative: false });
    containerOuter.text("24").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 240, cx: 0, cy: 0, relative: false });
    containerOuter.text("30").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 300, cx: 0, cy: 0, relative: false });
    containerOuter.text("33").style('font-size', '24px')
        .cx(0).cy(-hsiSettings.horizontalLine.h * 1.25)
        .transform({ rotation: 330, cx: 0, cy: 0, relative: false });


    for (var degree = 0; degree < 360; degree += 5) {
        if (degree % 90 == 0) continue;
        var h = 10;
        if (degree % 15 == 0) h = 20;
        var miniline = containerOuter.rect(h / 5, h);
        miniline.cx(0).cy(-hsiSettings.horizontalLine.h * 1.05);
        miniline.transform({ rotation: degree, cx: 0, cy: 0, relative: false });
        miniline.style("fill", "gray");
    }

    /*****************/
    var containerCenter = image.group();
    var containerCenterCircle = containerCenter.circle(hsiSettings.horizontalLine.h * 2.0);
    containerCenterCircle.cx(0).cy(0);
    containerCenterCircle.style('fill', "transparent");
    containerCenterCircle.style('stroke', "#000000");
    containerCenterCircle.style('stroke-width', hsiSettings.horizontalLine.h * 0.01);

    var verticalLineDirection = containerCenter.rect(hsiSettings.horizontalLine.w, hsiSettings.horizontalLine.h);
    verticalLineDirection.cx(0).cy(0);
    verticalLineDirection.style("fill", hsiSettings.horizontalLine.color);

    for (var hsiIndex = -3; hsiIndex < 4; hsiIndex++) {
        var c = containerCenter.circle(hsiSettings.middleCircleSize);
        c.cx(hsiSettings.middleCircleDistance * hsiIndex).cy(0);
    }
    /*****************/
    var arrow = containerCenter.polygon('0,0 10,20 5,20 5,40 -5,40 -5,20 -10,20');
    arrow.cy(-hsiSettings.horizontalLine.h * 0.8);
    containerCenter.rect(10, 40).cx(0).cy(hsiSettings.horizontalLine.h * 0.8);

    /*****************/
    var radial = containerCenter.polygon('0,0 -10,-15 -5,-15 -1,-5 1,-5 5,-15 10,-15 ');
    radial.cy(-hsiSettings.horizontalLine.h * 1.08);
    radial.style("fill", hsiSettings.horizontalLine.color);

    /*****************/
    var centerLine = image.rect(5, 50);
    centerLine.cx(0);
    centerLine.cy(-hsiSettings.horizontalLine.h * 1.2);
    centerLine.style("fill", hsiSettings.horizontalLine.color);

    image.rect(2, 30).cx(0).cy(5);
    image.rect(10, 2).cx(0).cy(15);
    image.rect(30, 2).cx(0).cy(0);

    /*****************/
    this.containerOuter = containerOuter;
    this.containerCenter = containerCenter;
    this.slopeLeft = slopeLeft;
    this.slopeRight = slopeRight;
    this.radial = radial;
    this.verticalLineDirection = verticalLineDirection;
    this.canvas = document.getElementById(this.locationId);
    this.width = -1;
    this.height = -1;
}


HSICircleRenderer.prototype = {
    constructor: HSICircleRenderer,
    resize: function () {
        var canvasWidth = this.canvas.parentElement.offsetWidth;

        if (canvasWidth !== this.width) {
            this.width = canvasWidth;
            this.height = canvasWidth * 0.5;

            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    },
    update: function (outer, item, center, vertical, radial, glideSlope) {
        this.containerOuter.transform({ rotation: -outer, cx: 0, cy: 0, relative: false });
        this.radial.transform({ rotation: radial, cx: 0, cy: 0, relative: false });
        this.containerCenter.transform({ rotation: -center, cx: 0, cy: 0, relative: false });
        if (vertical > 6) vertical = 6;
        if (vertical < -6) vertical = -6;
        this.verticalLineDirection.cx(-vertical * 25 / 2);
        if (glideSlope > 15) glideSlope = 15;
        if (glideSlope < -15) glideSlope = -15;
        this.slopeLeft.cy(-glideSlope * 25 / 3);
        this.slopeRight.cy(-glideSlope * 25 / 3);
    }
};

