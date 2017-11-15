var config = require('./config');
var rq     = require('request-promise');

const vstsAuth = 'Basic ' + new Buffer(config.vstsUsername + ':' + config.vstsToken).toString('base64');
const idMatcher = /_workitems\/edit\/(\d+)/;
const slackUnfurl = "https://slack.com/api/chat.unfurl";

function decodeHTMLEntities(text) {
    var entities = [
        ['amp', '&'],
        ['apos', '\''],
        ['#x27', '\''],
        ['#x2F', '/'],
        ['#39', '\''],
        ['#47', '/'],
        ['lt', '<'],
        ['gt', '>'],
        ['nbsp', ' '],
        ['quot', '"']
    ];

    for (var i = 0, max = entities.length; i < max; ++i) 
        text = text.replace(new RegExp('&'+entities[i][0]+';', 'g'), entities[i][1]);

    return text;
}

function removeHTML(str){
    if(! str) return '';
    return str.replace(/<\/?[^>]+(>|$)/g, "");
}

function formatText(str){
    if(! str) return '';
    return  decodeHTMLEntities( removeHTML(str) );
}


function toMailto(str){
    if(! str) return '';
    var splits = str.match('(.*[^<]) (<.*@{1}.*>)');
    return '<mailto:'+ splits[2].substr(1,splits[2].length - 2) +'|'+ splits[1] +'>';
}


function getWorkitem(url)
{
    var id = url.match(idMatcher)[1];
    return rq.get('https://' + config.vstsServer +'/DefaultCollection/_apis/wit/workitems/' + id +'?api-version=1.0', {
        headers: {'Authorization': vstsAuth}
    });
}


exports.handler = function(event, context, callback){

    function res(body){
        return callback(null, {
            statusCode:'200',
            body: body,
            headers: {
            'Content-Type': 'application/json',
        }});
    }

    var body = JSON.parse(event.body);

    if (body.challenge) {
        return res(body.challenge);
    }

    var unfurls  = {};

    function postToSlack(){
        
        var unfurl = JSON.stringify(unfurls);

        var data = {
            channel: body.event.channel,
            ts: body.event.message_ts,
            unfurls: unfurl
        };

        rq.post(slackUnfurl + '?token='+ config.slackToken).form(data)
            .then(console.log)
    }

    function createAttachment(workitem){
        var colors ={
            'Epic': '#ff7b00',
            'Feature': '#773b93',
            'User Story': '#009ccc',
            'Bug': '#cc293d',
            'Request': '#339947',
            'Task': '#f2cb1d'
        }

        var emoji = {
            'Epic': ':crown:',
            'Feature': ':trophy:',
            'User Story' :':book:',
            'Bug' :':glitch_crab:',
            'Request' :':memo:',
            'Task' :':spiral_note_pad:',
        };

        var workType = workitem.fields['System.WorkItemType'];


        var attachment =  {
            "color": colors[workType],
            "pretext": workitem.fields['System.Title'],
            "author_name":emoji[workType] + ' ' +workType.toUpperCase() + ' ' + workitem.id,
            "title": "Discription",
            "text": workType == 'Bug'? formatText(workitem.fields['Microsoft.VSTS.TCM.ReproSteps']) : formatText(workitem.fields['System.Description']),
            "fields": [
                {
                    "title": "State",
                    "value": workitem.fields['System.State'],
                    "short": false
                },
                {
                    "title": "Severity",
                    "value": workitem.fields['Microsoft.VSTS.Common.Severity'],
                    "short": false
                },
                {
                    "title": "Created By",
                    "value": toMailto(workitem.fields['System.CreatedBy']),  
                    "short": false
                }
            ],
  
            "footer": "Created",
            "ts": + new Date(workitem.fields['System.CreatedDate']) / 1000
        };

        if(workitem.fields['System.State'] != 'New' && (workType == 'Bug' || workType == 'User Story') ){
            attachment.fields.push({
                "title": "Deployed To",
                "value": workitem.fields['System.BoardLane'],
                "short": false
            });
        }

        return attachment;
    }

    Promise.all(body.event.links.map(function(obj){
        
        return getWorkitem(obj.url)
            .then(function(d){
                unfurls[obj.url] = createAttachment(JSON.parse(d))
            });

    })).then(postToSlack);
}; 
 