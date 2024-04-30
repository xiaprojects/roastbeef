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
 * HSI
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





/**
 * Heading
 * @param {*} locationId 
 * @param {*} item 
 */
function HeadingCircleRenderer(locationId, item) {
    this.width = -1;
    this.height = -1;

    this.locationId = locationId;
    this.canvas = document.getElementById(this.locationId);
    var image = SVG(this.locationId).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
    this.image = image;
    const plane = image.path(d = "M 247.51404,152.40266 139.05781,71.800946 c 0.80268,-12.451845 1.32473,-40.256266 0.85468,-45.417599 -3.94034,-43.266462 -31.23018,-24.6301193 -31.48335,-5.320367 -0.0693,5.281361 -1.01502,32.598388 -1.10471,50.836622 L 0.2842717,154.37562 0,180.19575 l 110.50058,-50.48239 3.99332,80.29163 -32.042567,22.93816 -0.203845,16.89693 42.271772,-11.59566 0.008,0.1395 42.71311,10.91879 -0.50929,-16.88213 -32.45374,-22.39903 2.61132,-80.35205 111.35995,48.50611 -0.73494,-25.77295 z")
    plane.cx(0).cy(0);

    this.pointer_el = image.group().addClass('card');

    const sectors = 8;
    const circleDiameter = 400 - 10 - 60;
    for (var r = 0; r < sectors; r++) {

        const displace = r * (360 / sectors);
        this.pointer_el.line(-100, 0, -160, 0).addClass('big').transform({ rotation: displace, cx: 0, cy: 0, relative: false });
        var rad = ((displace - 90) * 2 * Math.PI / 360.0)
        if (displace % 90 != 0) {
            this.pointer_el.text("" + displace)
                //.addClass('text')
                .style('font-size', '24px')
                //.cx(-180).cy(0)
                .cx(Math.cos(rad) * (circleDiameter * 1.12) / 2.0).cy(Math.sin(rad) * circleDiameter * 1.12 / 2.0)
        }
    }

    for (var r = 0; r < sectors; r++) {
        const displace = r * (360 / sectors);
        this.pointer_el.line(-100, 0, -160, 0).addClass('small').transform({ rotation: displace + 45.0 / 2.0, cx: 0, cy: 0, relative: false });
    }

    this.pointer_el.text("N").style('font-size', '32px').style("fill", "#ff0000").style("stroke", "#ff0000")
        .cx(0).cy(-180);
    this.pointer_el.text("E").style('font-size', '32px')//.style("fill", "#000000")
        .cx(180).cy(0)
    this.pointer_el.text("W").style('font-size', '32px')//.style("fill", "#000000")
        .cx(-180).cy(0)
    this.pointer_el.text("S").style('font-size', '32px')//.style("fill", "#000000")
        .cx(0).cy(180)

}

HeadingCircleRenderer.prototype = {
    constructor: HeadingCircleRenderer,
    resize: function () {
        var canvasWidth = this.canvas.parentElement.offsetWidth - 12;

        if (canvasWidth !== this.width) {
            this.width = canvasWidth;
            this.height = canvasWidth * 0.5;

            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    },
    update: function (value, item) {
        //this.card.text=value;
        if (value < this.min) {
            value = this.min;
        }
        if (value > this.max) {
            value = this.max;
        }
        this.pointer_el.rotate(-value, 0, 0);
    }
};


/**
 * EMS
 * @param {*} locationId 
 * @param {*} item 
 */
function EMSGenericCircleRenderer(locationId, item) {
    this.width = -1;
    this.height = -1;
    this.locationId = locationId;
    this.canvas = document.getElementById(this.locationId);
    var image = SVG(this.locationId).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
    this.image = image;
    var el, card = image.group().addClass('card');
    const circleDiameter = 400 - 10 - 60;
    item.backround = card.circle(circleDiameter).cx(0).cy(0).style('fill', item.background)
    var diameter = circleDiameter * 8.0 / 10.0;
    var donutHeight = circleDiameter - diameter - 4;
    const circumference = 2.0 * Math.PI * diameter / 2.0;
    var maxRange = 0;
    var minRange = 32000;
    for (var r = 0; r < item.ranges.length; r++) {
        var range = item.ranges[r];
        if (range.min < minRange) {
            minRange = range.min;
        }
        if (range.max > maxRange) {
            maxRange = range.max;
        }
    }
    this.min = minRange;
    this.max = maxRange;

    for (var r = 0; r < item.ranges.length; r++) {
        var range = item.ranges[r];
        var circle = card.circle(diameter).cx(0).cy(0);
        circle.style('stroke-width', donutHeight);
        circle.style('stroke', range.color);
        circle.style('fill', "transparent");
        const percentage = 100.0 * (range.max - range.min) / (maxRange - minRange) * item.circleSize / 360.0;
        const strokeDash = Math.round((percentage * circumference) / 100);
        const strokeDashArray = `${strokeDash} ${circumference}`;
        circle.style('stroke-dasharray', strokeDashArray);
        const displace = item.rotate + item.circleSize * (range.min) / (maxRange- minRange);
        circle.transform({ rotation: displace, cx: 0, cy: 0, relative: false })
        range.svg = circle;
        card.line(-120, 0, -160, 0).addClass('small').transform({ rotation: displace + 180, cx: 0, cy: 0, relative: false });

        const rad = 2 * Math.PI * displace / 360.0;
        card.text("" + (range.min / item.scale)).addClass('textMini')
            .style('font-size', '32px')
            .cx(Math.cos(rad) * (circleDiameter * 1.12) / 2.0).cy(Math.sin(rad) * circleDiameter * 1.12 / 2.0)
        if (r == item.ranges.length - 1) {
            const displace = item.rotate + item.circleSize * (range.max) / (maxRange-minRange);
            const rad = 2 * Math.PI * displace / 360.0;
            card.text("" + (range.max / item.scale)).addClass('textMini')
                .style('font-size', '32px')
                .cx(Math.cos(rad) * (circleDiameter * 1.12) / 2.0).cy(Math.sin(rad) * circleDiameter * 1.12 / 2.0)

        }
    }

    image.group().text(item.uiModel).style('font-size', '38px').addClass('textMini').cx(50).cy(-40);

    this.min_el = image.group().addClass('min').style("opacity", 0.5);
    this.min_el.polygon('0,0 -170,0 -160,-5 0,-5').addClass('pointer');
    this.min_el.polygon('0,0 -170,0 -160,+5 0,+5').addClass('pointerBG');


    this.max_el = image.group().addClass('max').style("opacity", 0.5);
    this.max_el.polygon('0,0 -170,0 -150,-5 0,-5').addClass('pointer');
    this.max_el.polygon('0,0 -170,0 -150,+5 0,+5').addClass('pointerBG');


    this.pointer_el = image.group()//.addClass('pointer_el');

    this.pointer_el.polygon('40,0 -140,0 -120,-10 0,-10').addClass('pointer');
    this.pointer_el.polygon('40,0 -140,0 -120,+10 0,+10').addClass('pointerBG');
    var middle = image.group().cx(0).cy(0).addClass('text');
    middle.rect(220, 80).cx(0).cy(90).style('fill', '#4c4c4c').style('rx', '10').style('stroke-width', '2');
    this.textMiddle = middle.text(item.format.replace("X", item.value))
        .style('fill', 'white')
        .style('font-size', '64px').cx("50%").cy(90);
    image.circle(40).cx(0).cy(0).addClass('center');
    this.resize();
}


EMSGenericCircleRenderer.prototype = {
    constructor: EMSGenericCircleRenderer,

    resize: function () {
        var canvasWidth = this.canvas.parentElement.offsetWidth - 12;

        if (canvasWidth !== this.width) {
            this.width = canvasWidth;
            this.height = canvasWidth * 0.5;

            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    },

    update: function (value, item) {
        //this.card.text=value;
        if (value < this.min) {
            value = this.min;
        }
        if (value > this.max) {
            value = this.max;
        }
        for (var r = 0; r < item.ranges.length; r++) {
            var range = item.ranges[r];
            if (range.hasOwnProperty("svg") == false) { }
            else {
                if (value > range.max || value < range.min) {
                    //range["svg"].style("opacity",0.3);
                    range["svg"].style("stroke", range.colorOff);
                    //range["svg"].style("fill","#00ffff");
                }
                else {
                    //range["svg"].style("opacity",1.0);
                    range["svg"].style("stroke", range.color);
                    this.textMiddle.style('fill', range.color)
                    item.backround.style('fill', range.colorOff).style("opacity", 0.5);
                }
            }
        }
        if (item.valueMin > value) {
            item.valueMin = value;
            this.min_el.rotate(item.rotate - 180 + item.circleSize * (value) / (this.max-this.min), 0, 0);
        }
        if (item.valueMax < value) {
            item.valueMax = value;
            this.max_el.rotate(item.rotate - 180 + item.circleSize * (value) / (this.max-this.min), 0, 0);
        }
        this.pointer_el.rotate(item.rotate - 180 + item.circleSize * (value) / (this.max-this.min), 0, 0);
        this.textMiddle.text(item.format.replace("X", (item.value).toFixed(item.ceil)))
    }
};



/**
 * Altimeter
 */
class AltimeterCircleRenderer extends EMSGenericCircleRenderer {
    update(value, item) {
        for (var r = 0; r < item.ranges.length; r++) {
            var range = item.ranges[r];
            if (range.hasOwnProperty("svg") == false) { }
            else {
                if (value > range.max || value < range.min) {
                    //range["svg"].style("opacity",0.3);
                    range["svg"].style("stroke", range.colorOff);
                    //range["svg"].style("fill","#00ffff");
                }
                else {
                    //range["svg"].style("opacity",1.0);
                    range["svg"].style("stroke", range.color);
                    this.textMiddle.style('fill', "white")
                    item.backround.style('fill', range.colorOff).style("opacity", 0.8);
                }
            }
        }

        this.min_el.rotate(item.rotate - 180 + item.circleSize * (value/100) / (this.max), 0, 0);
        this.min_el.style("opacity", 1);
        this.max_el.style("opacity", 0);
        this.pointer_el.rotate(item.rotate - 180 + item.circleSize * (value/1000) / (this.max), 0, 0);
        this.textMiddle.text(item.format.replace("X", (item.value).toFixed(item.ceil)))
    }
}



function DirectionCircleRenderer(locationId, item) {
    this.width = -1;
    this.height = -1;

    this.locationId = locationId;
    this.canvas = document.getElementById(this.locationId);
    var image = SVG(this.locationId).viewbox(-200, -200, 400, 400).group().addClass('CockpitWhite');
    this.image = image;
    const plane = image.path(d = "M 247.51404,152.40266 139.05781,71.800946 c 0.80268,-12.451845 1.32473,-40.256266 0.85468,-45.417599 -3.94034,-43.266462 -31.23018,-24.6301193 -31.48335,-5.320367 -0.0693,5.281361 -1.01502,32.598388 -1.10471,50.836622 L 0.2842717,154.37562 0,180.19575 l 110.50058,-50.48239 3.99332,80.29163 -32.042567,22.93816 -0.203845,16.89693 42.271772,-11.59566 0.008,0.1395 42.71311,10.91879 -0.50929,-16.88213 -32.45374,-22.39903 2.61132,-80.35205 111.35995,48.50611 -0.73494,-25.77295 z")
    plane.cx(0).cy(0);

    this.pointer_el = image.group().addClass('card');

    const sectors = 8;
    const circleDiameter = 400 - 10 - 60;
    for (var r = 0; r < sectors; r++) {

        const displace = r * (360 / sectors);
        this.pointer_el.line(-100, 0, -160, 0).addClass('big').transform({ rotation: displace, cx: 0, cy: 0, relative: false });
        var rad = ((displace - 90) * 2 * Math.PI / 360.0)
        if (displace % 90 != 0) {
            this.pointer_el.text("" + displace)
                //.addClass('text')
                .style('font-size', '24px')
                //.cx(-180).cy(0)
                .cx(Math.cos(rad) * (circleDiameter * 1.12) / 2.0).cy(Math.sin(rad) * circleDiameter * 1.12 / 2.0)
        }
    }

    for (var r = 0; r < sectors; r++) {
        const displace = r * (360 / sectors);
        this.pointer_el.line(-100, 0, -160, 0).addClass('small').transform({ rotation: displace + 45.0 / 2.0, cx: 0, cy: 0, relative: false });
    }

    this.pointer_el.text("N").style('font-size', '32px').style("fill", "#ff0000").style("stroke", "#ff0000")
        .cx(0).cy(-180);
    this.pointer_el.text("E").style('font-size', '32px')//.style("fill", "#000000")
        .cx(180).cy(0)
    this.pointer_el.text("W").style('font-size', '32px')//.style("fill", "#000000")
        .cx(-180).cy(0)
    this.pointer_el.text("S").style('font-size', '32px')//.style("fill", "#000000")
        .cx(0).cy(180)

}

DirectionCircleRenderer.prototype = {
    constructor: DirectionCircleRenderer,

    resize: function () {
        var canvasWidth = this.canvas.parentElement.offsetWidth - 12;

        if (canvasWidth !== this.width) {
            this.width = canvasWidth;
            this.height = canvasWidth * 0.5;

            this.canvas.width = this.width;
            this.canvas.height = this.height;
        }
    },
    update: function (value, item) {
        //this.card.text=value;
        if (value < this.min) {
            value = this.min;
        }
        if (value > this.max) {
            value = this.max;
        }
        this.pointer_el.rotate(-value, 0, 0);

    }
};